// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Hamza Gouda
//
// Fake system services for tools/shell_qa.py. The headless shell runs on a
// private system bus, so it never talks to the real logind, NetworkManager,
// BlueZ, UPower or asusd of the machine; these stand-ins give Quick Settings,
// the lock screen and the end-session dialog something to show. All names,
// networks and devices are made up. Nothing here does anything when called.
//
// Run: gjs -m tools/qa/mockbus.js READY_FILE   (system bus = $DBUS_SYSTEM_BUS_ADDRESS)

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import System from 'system';

const V = (t, v) => new GLib.Variant(t, v);
const bytes = s => new TextEncoder().encode(s);
const NO = '/';
const refuse = (_args, inv) => inv.return_dbus_error('org.freedesktop.DBus.Error.AccessDenied', 'mock');

// ---- tiny spec -> XML -> exported object --------------------------------------
// props: {Name: [sig, value, 'readwrite'?]}, methods: {Name: [inSigs[], outSigs[], fn]},
// signals: {Name: [sigs...]}

function xmlFor(iface, props = {}, methods = {}, signals = {}) {
    let x = `<node><interface name="${iface}">`;
    for (const [n, [sig, , access]] of Object.entries(props))
        x += `<property name="${n}" type="${sig}" access="${access ?? 'read'}"/>`;
    for (const [n, [ins, outs]] of Object.entries(methods)) {
        x += `<method name="${n}">`;
        for (const s of ins)
            x += `<arg type="${s}" direction="in"/>`;
        for (const s of outs)
            x += `<arg type="${s}" direction="out"/>`;
        x += '</method>';
    }
    for (const [n, sigs] of Object.entries(signals))
        x += `<signal name="${n}">${sigs.map(s => `<arg type="${s}"/>`).join('')}</signal>`;
    return `${x}</interface></node>`;
}

function makeImpl(iface, props = {}, methods = {}, signals = {}) {
    const obj = {};
    for (const [n, [, value]] of Object.entries(props))
        obj[n] = value;
    // [ins, outs, fn] runs fn(...args); [ins, outs, fn, 'async'] gets (args, invocation).
    for (const [n, [, , fn, async]] of Object.entries(methods)) {
        if (async)
            obj[`${n}Async`] = fn;
        else
            obj[n] = fn ?? (() => {});
    }
    const impl = Gio.DBusExportedObject.wrapJSObject(xmlFor(iface, props, methods, signals), obj);
    // Writable properties announce changes like the real daemons do, e.g. a
    // Properties.Set of asusd PlatformProfile emits PropertiesChanged (what
    // Fn+F5 looks like to the shell).
    for (const [n, [sig, value, access]] of Object.entries(props)) {
        if (access !== 'readwrite')
            continue;
        let current = value;
        Object.defineProperty(obj, n, {
            enumerable: true,
            get: () => current,
            set: v => {
                if (v === current)
                    return;
                current = v;
                impl.emit_property_changed(n, new GLib.Variant(sig, v));
            },
        });
    }
    impl._js = obj;
    return impl;
}

const exported = [];
function exportOn(conn, path, iface, props, methods, signals) {
    const impl = makeImpl(iface, props, methods, signals);
    impl.export(conn, path);
    exported.push(impl);
    return impl;
}

// Object-manager services (BlueZ, NetworkManager): libnm and gnome-bluetooth read
// everything through GetManagedObjects.
function managed(conn, root, objects) {
    const server = Gio.DBusObjectManagerServer.new(root);
    for (const [path, ifaces] of objects) {
        const o = Gio.DBusObjectSkeleton.new(path);
        for (const [iface, props, methods, signals] of ifaces)
            o.add_interface(makeImpl(iface, props, methods, signals));
        server.export(o);
    }
    server.set_connection(conn);
    return server;
}

// ---- system bus ---------------------------------------------------------------
function systemServices(conn) {
    const uid = new Gio.Credentials().get_unix_user();
    const S = '/org/freedesktop/login1/session/c1';
    const U = `/org/freedesktop/login1/user/_${uid}`;
    const sessionProps = {
        Id: ['s', 'c1'], Name: ['s', 'qa'], Active: ['b', true], Class: ['s', 'user'],
        Remote: ['b', false], State: ['s', 'active'], Type: ['s', 'wayland'],
        LockedHint: ['b', false], Seat: ['(so)', ['seat0', '/org/freedesktop/login1/seat/seat0']],
        User: ['(uo)', [uid, U]],
    };
    const sess = exportOn(conn, S, 'org.freedesktop.login1.Session', sessionProps, {
        SetLockedHint: [['b'], [], v => {
            sess._js.LockedHint = v;
        }],
        Lock: [[], []], Unlock: [[], []], Activate: [[], []], Terminate: [[], []],
        SetIdleHint: [['b'], []],
    }, {Lock: [], Unlock: []});
    const SEAT = '/org/freedesktop/login1/seat/seat0';
    exportOn(conn, SEAT, 'org.freedesktop.login1.Seat', {
        Id: ['s', 'seat0'], ActiveSession: ['(so)', ['c1', S]], CanGraphical: ['b', true],
        CanMultiSession: ['b', true], CanTTY: ['b', true], Sessions: ['a(so)', [['c1', S]]],
    }, {SwitchTo: [['u'], []], ActivateSession: [['s'], []]});
    for (const p of [U, '/org/freedesktop/login1/user/self']) {
        exportOn(conn, p, 'org.freedesktop.login1.User', {
            Display: ['(so)', ['c1', S]], Sessions: ['a(so)', [['c1', S]]],
            Name: ['s', 'qa'], UID: ['u', uid], State: ['s', 'active'],
        });
    }
    const yes = () => 'yes';
    exportOn(conn, '/org/freedesktop/login1', 'org.freedesktop.login1.Manager', {
        Docked: ['b', false], LidClosed: ['b', false], OnExternalPower: ['b', false],
    }, {
        GetSession: [['s'], ['o'], () => S],
        GetSessionByPID: [['u'], ['o'], () => S],
        GetUser: [['u'], ['o'], () => U],
        GetSeat: [['s'], ['o'], () => SEAT],
        ListSeats: [[], ['a(so)'], () => [['seat0', SEAT]]],
        ListSessions: [[], ['a(susso)'], () => [['c1', uid, 'qa', 'seat0', S]]],
        CanPowerOff: [[], ['s'], yes], CanReboot: [[], ['s'], yes], CanSuspend: [[], ['s'], yes],
        CanHibernate: [[], ['s'], () => 'no'], CanHybridSleep: [[], ['s'], () => 'no'],
        CanSuspendThenHibernate: [[], ['s'], () => 'no'],
        CanRebootToBootLoaderMenu: [[], ['s'], () => 'no'],
        SetRebootToBootLoaderMenu: [['t'], []],
        PowerOff: [['b'], []], Reboot: [['b'], []], Suspend: [['b'], []],
        // An inhibitor needs an fd; refusing is what logind does without permission.
        Inhibit: [['s', 's', 's', 's'], ['h'], refuse, 'async'],
    }, {PrepareForSleep: ['b'], PrepareForShutdown: ['b'], SessionNew: ['s', 'o']});

    const userPath = `/org/freedesktop/Accounts/User${uid}`;
    exportOn(conn, '/org/freedesktop/Accounts', 'org.freedesktop.Accounts', {
        DaemonVersion: ['s', '23.13.0'], HasNoUsers: ['b', false], HasMultipleUsers: ['b', false],
        AutomaticLoginUsers: ['ao', []],
    }, {
        FindUserByName: [['s'], ['o'], () => userPath],
        FindUserById: [['x'], ['o'], () => userPath],
        ListCachedUsers: [[], ['ao'], () => [userPath]],
        CacheUser: [['s'], ['o'], () => userPath],
    }, {UserAdded: ['o'], UserDeleted: ['o']});
    exportOn(conn, userPath, 'org.freedesktop.Accounts.User', {
        Uid: ['t', uid], UserName: ['s', GLib.get_user_name()], RealName: ['s', 'Bordeaux'],
        AccountType: ['i', 0], HomeDirectory: ['s', GLib.get_home_dir()], Shell: ['s', '/bin/bash'],
        Email: ['s', ''], Language: ['s', ''], Languages: ['as', []], Session: ['s', ''],
        SessionType: ['s', ''], XSession: ['s', ''], Location: ['s', ''],
        LoginFrequency: ['t', 0], LoginTime: ['x', 0], LoginHistory: ['a(xxa{sv})', []],
        IconFile: ['s', ''], Saved: ['b', true], Locked: ['b', false], PasswordMode: ['i', 0],
        PasswordHint: ['s', ''], AutomaticLogin: ['b', false], SystemAccount: ['b', false],
        LocalAccount: ['b', true],
    }, {}, {Changed: []});

    const DD = '/org/freedesktop/UPower/devices/DisplayDevice';
    const BAT = '/org/freedesktop/UPower/devices/battery_BAT1';
    exportOn(conn, '/org/freedesktop/UPower', 'org.freedesktop.UPower', {
        OnBattery: ['b', true], DaemonVersion: ['s', '1.90.3'], LidIsClosed: ['b', false],
        LidIsPresent: ['b', true],
    }, {
        EnumerateDevices: [[], ['ao'], () => [BAT]],
        GetDisplayDevice: [[], ['o'], () => DD],
        GetCriticalAction: [[], ['s'], () => 'PowerOff'],
    }, {DeviceAdded: ['o'], DeviceRemoved: ['o']});
    const battery = {
        Type: ['u', 2], State: ['u', 2], Percentage: ['d', 76], TimeToEmpty: ['x', 4 * 3600 + 20 * 60],
        TimeToFull: ['x', 0], IsPresent: ['b', true], IconName: ['s', 'battery-good-symbolic'],
        PowerSupply: ['b', true], WarningLevel: ['u', 1], BatteryLevel: ['u', 1],
        IsRechargeable: ['b', true], Online: ['b', false], NativePath: ['s', 'BAT1'],
        Vendor: ['s', ''], Model: ['s', ''], Serial: ['s', ''], Energy: ['d', 38.0],
        EnergyFull: ['d', 50.0], EnergyRate: ['d', 8.7],
    };
    exportOn(conn, DD, 'org.freedesktop.UPower.Device', battery, {Refresh: [[], []]});
    exportOn(conn, BAT, 'org.freedesktop.UPower.Device', battery, {Refresh: [[], []]});

    const prof = (p, d) => ({Profile: V('s', p), Driver: V('s', d), PlatformDriver: V('s', d)});
    exportOn(conn, '/net/hadess/PowerProfiles', 'net.hadess.PowerProfiles', {
        ActiveProfile: ['s', 'balanced', 'readwrite'], PerformanceInhibited: ['s', ''],
        PerformanceDegraded: ['s', ''], Version: ['s', '0.20'], Actions: ['as', []],
        ActiveProfileHolds: ['aa{sv}', []],
        Profiles: ['aa{sv}', [prof('power-saver', 'platform_profile'),
            prof('balanced', 'platform_profile'), prof('performance', 'platform_profile')]],
    }, {HoldProfile: [['s', 's', 's'], ['u'], () => 1], ReleaseProfile: [['u'], []]});

    // GDM: the shell only creates its lock screen when a display manager answers.
    exportOn(conn, '/org/gnome/DisplayManager/Manager', 'org.gnome.DisplayManager.Manager', {
        Version: ['s', '46.0'],
    }, {
        RegisterSession: [['a{sv}'], []],
        OpenReauthenticationChannel: [['s'], ['s'], refuse, 'async'],
        OpenSession: [[], ['s'], refuse, 'async'],
    });

    // asusd and supergfxd, for the TUF Control Quick Settings toggle.
    exportOn(conn, '/xyz/ljones', 'xyz.ljones.Platform', {
        PlatformProfile: ['u', 0, 'readwrite'], PlatformProfileChoices: ['au', [0, 1, 2]],
        ChargeControlEndThreshold: ['y', 80, 'readwrite'],
    });
    exportOn(conn, '/org/supergfxctl/Gfx', 'org.supergfxctl.Daemon', {}, {
        Mode: [[], ['u'], () => 0],
    }, {NotifyGfx: ['u']});

    // BlueZ: one adapter, three made-up devices.
    const A2DP = ['0000110b-0000-1000-8000-00805f9b34fb', '0000111e-0000-1000-8000-00805f9b34fb'];
    const HID = ['00001124-0000-1000-8000-00805f9b34fb'];
    const dev = (mac, name, icon, cls, uuids, connected, battery) => {
        const p = `/org/bluez/hci0/dev_${mac.replaceAll(':', '_')}`;
        const ifaces = [['org.bluez.Device1', {
            Address: ['s', mac], AddressType: ['s', 'public'], Name: ['s', name], Alias: ['s', name],
            Class: ['u', cls], Icon: ['s', icon], Paired: ['b', true], Bonded: ['b', true],
            Trusted: ['b', true], Blocked: ['b', false], LegacyPairing: ['b', false],
            Connected: ['b', connected], ServicesResolved: ['b', connected], UUIDs: ['as', uuids],
            Adapter: ['o', '/org/bluez/hci0'], WakeAllowed: ['b', false],
        }, {Connect: [[], []], Disconnect: [[], []], ConnectProfile: [['s'], []],
            DisconnectProfile: [['s'], []], Pair: [[], []], CancelPairing: [[], []]}]];
        if (battery !== null)
            ifaces.push(['org.bluez.Battery1', {Percentage: ['y', battery], Source: ['s', 'HFP']}]);
        return [p, ifaces];
    };
    managed(conn, '/', [
        ['/org/bluez', [['org.bluez.AgentManager1', {}, {
            RegisterAgent: [['o', 's'], []], RequestDefaultAgent: [['o'], []],
            UnregisterAgent: [['o'], []]}]]],
        ['/org/bluez/hci0', [['org.bluez.Adapter1', {
            Address: ['s', '00:1A:7D:DA:71:13'], AddressType: ['s', 'public'], Name: ['s', 'bordeaux'],
            Alias: ['s', 'bordeaux', 'readwrite'], Class: ['u', 0x6c010c],
            Powered: ['b', true, 'readwrite'], PowerState: ['s', 'on'],
            Discoverable: ['b', false, 'readwrite'], DiscoverableTimeout: ['u', 180, 'readwrite'],
            Pairable: ['b', true, 'readwrite'], PairableTimeout: ['u', 0, 'readwrite'],
            Discovering: ['b', false], UUIDs: ['as', []], Modalias: ['s', 'usb:v1D6Bp0246d0540'],
        }, {StartDiscovery: [[], []], StopDiscovery: [[], []], RemoveDevice: [['o'], []],
            SetDiscoveryFilter: [['a{sv}'], []]}]]],
        dev('3C:A1:0F:22:41:7E', 'Studio Headphones', 'audio-headphones', 0x240418, A2DP, true, 80),
        dev('F4:73:35:9B:0C:21', 'Wireless Mouse', 'input-mouse', 0x002580, HID, false, null),
        dev('70:26:05:C3:9E:4A', 'Living Room Speaker', 'audio-speakers', 0x240414, A2DP, false, null),
    ]);

    // NetworkManager: one Wi-Fi card connected to "Bordeaux-5G", a few networks around.
    const NM = '/org/freedesktop/NetworkManager';
    const DEV = `${NM}/Devices/1`, AC = `${NM}/ActiveConnection/1`, CON = `${NM}/Settings/1`;
    const nets = [
        ['Bordeaux-5G', 92, 5180], ['Cave a Vin', 71, 2437], ['Atelier', 58, 5240],
        ['Chateau Guest', 44, 2412], ['Merlot', 30, 2462],
    ];
    const now = Math.floor(GLib.get_monotonic_time() / 1e6);
    const aps = nets.map(([ssid, strength, freq], i) => [`${NM}/AccessPoint/${i + 1}`, [[
        'org.freedesktop.NetworkManager.AccessPoint', {
            Flags: ['u', 1], WpaFlags: ['u', 0], RsnFlags: ['u', 0x188], Ssid: ['ay', bytes(ssid)],
            Frequency: ['u', freq], HwAddress: ['s', `02:00:00:00:00:0${i + 1}`], Mode: ['u', 2],
            MaxBitrate: ['u', 866000], Strength: ['y', strength], LastSeen: ['i', now],
            Bandwidth: ['u', 80],
        }]]]);
    const apPaths = aps.map(a => a[0]);
    const wifiSettings = () => ({
        connection: {id: V('s', 'Bordeaux-5G'), uuid: V('s', '6f1c2b0e-8d0a-4a51-9c3e-000000000001'),
            type: V('s', '802-11-wireless'), autoconnect: V('b', true)},
        '802-11-wireless': {ssid: V('ay', bytes('Bordeaux-5G')), mode: V('s', 'infrastructure')},
        '802-11-wireless-security': {'key-mgmt': V('s', 'wpa-psk')},
        ipv4: {method: V('s', 'auto')}, ipv6: {method: V('s', 'auto')},
    });
    managed(conn, '/org/freedesktop', [
        [NM, [['org.freedesktop.NetworkManager', {
            Devices: ['ao', [DEV]], AllDevices: ['ao', [DEV]], Checkpoints: ['ao', []],
            NetworkingEnabled: ['b', true], WirelessEnabled: ['b', true, 'readwrite'],
            WirelessHardwareEnabled: ['b', true], WwanEnabled: ['b', false],
            WwanHardwareEnabled: ['b', false], ActiveConnections: ['ao', [AC]],
            PrimaryConnection: ['o', AC], PrimaryConnectionType: ['s', '802-11-wireless'],
            Metered: ['u', 4], ActivatingConnection: ['o', NO], Startup: ['b', false],
            Version: ['s', '1.46.0'], Capabilities: ['au', []], State: ['u', 70],
            Connectivity: ['u', 4], ConnectivityCheckAvailable: ['b', true],
            ConnectivityCheckEnabled: ['b', true], ConnectivityCheckUri: ['s', ''],
            GlobalDnsConfiguration: ['a{sv}', {}], RadioFlags: ['u', 1],
        }, {
            GetPermissions: [[], ['a{ss}'], () => Object.fromEntries([
                'enable-disable-network', 'enable-disable-wifi', 'enable-disable-wwan',
                'network-control', 'wifi.share.open', 'wifi.share.protected', 'settings.modify.own',
                'settings.modify.system'].map(p => [`org.freedesktop.NetworkManager.${p}`, 'yes']))],
            GetDevices: [[], ['ao'], () => [DEV]], GetAllDevices: [[], ['ao'], () => [DEV]],
            CheckConnectivity: [[], ['u'], () => 4], state: [[], ['u'], () => 70],
            ActivateConnection: [['o', 'o', 'o'], ['o'], () => AC],
            DeactivateConnection: [['o'], []], Enable: [['b'], []],
        }, {CheckPermissions: [], StateChanged: ['u'], DeviceAdded: ['o'], DeviceRemoved: ['o']}]]],
        [`${NM}/Settings`, [['org.freedesktop.NetworkManager.Settings', {
            Connections: ['ao', [CON]], Hostname: ['s', 'bordeaux'], CanModify: ['b', true],
        }, {
            ListConnections: [[], ['ao'], () => [CON]],
            GetConnectionByUuid: [['s'], ['o'], () => CON],
        }, {NewConnection: ['o'], ConnectionRemoved: ['o']}]]],
        [CON, [['org.freedesktop.NetworkManager.Settings.Connection', {
            Unsaved: ['b', false], Flags: ['u', 0], Filename: ['s', ''],
        }, {
            GetSettings: [[], ['a{sa{sv}}'], wifiSettings],
            GetSecrets: [['s'], ['a{sa{sv}}'], refuse, 'async'],
        }, {Updated: [], Removed: []}]]],
        [`${NM}/AgentManager`, [['org.freedesktop.NetworkManager.AgentManager', {}, {
            Register: [['s'], []], RegisterWithCapabilities: [['s', 'u'], []], Unregister: [[], []],
        }]]],
        [DEV, [['org.freedesktop.NetworkManager.Device', {
            Udi: ['s', '/sys/devices/virtual/net/wlan0'], Path: ['s', ''], Interface: ['s', 'wlan0'],
            IpInterface: ['s', 'wlan0'], Driver: ['s', 'mac80211_hwsim'], DriverVersion: ['s', ''],
            FirmwareVersion: ['s', ''], Capabilities: ['u', 1], State: ['u', 100],
            StateReason: ['(uu)', [100, 0]], ActiveConnection: ['o', AC], Ip4Config: ['o', NO],
            Dhcp4Config: ['o', NO], Ip6Config: ['o', NO], Dhcp6Config: ['o', NO],
            Managed: ['b', true], Autoconnect: ['b', true], FirmwareMissing: ['b', false],
            NmPluginMissing: ['b', false], DeviceType: ['u', 2], AvailableConnections: ['ao', [CON]],
            PhysicalPortId: ['s', ''], Mtu: ['u', 1500], Metered: ['u', 4], LldpNeighbors: ['aa{sv}', []],
            Real: ['b', true], Ip4Connectivity: ['u', 4], Ip6Connectivity: ['u', 4],
            InterfaceFlags: ['u', 0x10003], HwAddress: ['s', '02:00:00:00:01:00'], Ports: ['ao', []],
        }, {Disconnect: [[], []], Delete: [[], []]}, {StateChanged: ['u', 'u', 'u']}],
        ['org.freedesktop.NetworkManager.Device.Wireless', {
            HwAddress: ['s', '02:00:00:00:01:00'], PermHwAddress: ['s', '02:00:00:00:01:00'],
            Mode: ['u', 2], Bitrate: ['u', 866000], AccessPoints: ['ao', apPaths],
            ActiveAccessPoint: ['o', apPaths[0]], WirelessCapabilities: ['u', 0x3ff],
            LastScan: ['x', Math.floor(GLib.get_monotonic_time() / 1000)],
        }, {
            GetAccessPoints: [[], ['ao'], () => apPaths], GetAllAccessPoints: [[], ['ao'], () => apPaths],
            RequestScan: [['a{sv}'], []],
        }, {AccessPointAdded: ['o'], AccessPointRemoved: ['o']}]]],
        [AC, [['org.freedesktop.NetworkManager.Connection.Active', {
            Connection: ['o', CON], SpecificObject: ['o', apPaths[0]], Id: ['s', 'Bordeaux-5G'],
            Uuid: ['s', '6f1c2b0e-8d0a-4a51-9c3e-000000000001'], Type: ['s', '802-11-wireless'],
            Devices: ['ao', [DEV]], State: ['u', 2], StateFlags: ['u', 0], Default: ['b', true],
            Ip4Config: ['o', NO], Dhcp4Config: ['o', NO], Default6: ['b', false], Ip6Config: ['o', NO],
            Dhcp6Config: ['o', NO], Vpn: ['b', false], Controller: ['o', NO], Master: ['o', NO],
        }, {}, {StateChanged: ['u', 'u']}]]],
        ...aps,
    ]);
}

// ---- session bus: the gnome-settings-daemon and gnome-session bits the shell reads
function sessionServices(conn) {
    const P = '/org/gnome/SettingsDaemon/Power';
    exportOn(conn, P, 'org.gnome.SettingsDaemon.Power.Screen', {Brightness: ['i', 70, 'readwrite']},
        {StepUp: [[], ['i', 's'], () => [80, '']], StepDown: [[], ['i', 's'], () => [60, '']]});
    exportOn(conn, P, 'org.gnome.SettingsDaemon.Power.Keyboard', {
        Brightness: ['i', 50, 'readwrite'], Steps: ['i', 4],
    }, {StepUp: [[], ['i'], () => 75], StepDown: [[], ['i'], () => 25], Toggle: [[], ['i'], () => 0]});
    exportOn(conn, '/org/gnome/SettingsDaemon/Rfkill', 'org.gnome.SettingsDaemon.Rfkill', {
        AirplaneMode: ['b', false, 'readwrite'], HasAirplaneMode: ['b', true],
        HardwareAirplaneMode: ['b', false], ShouldShowAirplaneMode: ['b', true],
        BluetoothAirplaneMode: ['b', false, 'readwrite'], BluetoothHasAirplaneMode: ['b', true],
        BluetoothHardwareAirplaneMode: ['b', false, 'readwrite'],
    });
    exportOn(conn, '/org/gnome/SettingsDaemon/Color', 'org.gnome.SettingsDaemon.Color', {
        NightLightActive: ['b', false], DisabledUntilTomorrow: ['b', false, 'readwrite'],
        Temperature: ['u', 4700, 'readwrite'],
    });
    exportOn(conn, '/org/gnome/SessionManager', 'org.gnome.SessionManager', {
        SessionIsActive: ['b', true], InhibitedActions: ['u', 0], Renderer: ['s', ''],
    }, {
        Logout: [['u'], []], Shutdown: [[], []], Reboot: [[], []],
        CanShutdown: [[], ['b'], () => true], IsInhibited: [['u'], ['b'], () => false],
        GetInhibitors: [[], ['ao'], () => []],
    }, {InhibitorAdded: ['o'], InhibitorRemoved: ['o']});
    exportOn(conn, '/org/gnome/SessionManager/Presence', 'org.gnome.SessionManager.Presence', {
        status: ['u', 0, 'readwrite'],
    }, {SetStatus: [['u'], []]}, {StatusChanged: ['u']});
}

const SYSTEM_NAMES = ['org.freedesktop.login1', 'org.freedesktop.Accounts', 'org.freedesktop.UPower',
    'net.hadess.PowerProfiles', 'xyz.ljones.Asusd', 'org.supergfxctl.Daemon', 'org.bluez',
    'org.freedesktop.NetworkManager', 'org.gnome.DisplayManager'];
const SESSION_NAMES = ['org.gnome.SettingsDaemon.Power', 'org.gnome.SettingsDaemon.Rfkill',
    'org.gnome.SettingsDaemon.Color', 'org.gnome.SessionManager'];

const ready = ARGV[0];
// Never claim names on the machine's real system bus.
const sysAddr = GLib.getenv('DBUS_SYSTEM_BUS_ADDRESS') ?? '';
if (!sysAddr || sysAddr.includes('/run/dbus/') || sysAddr === GLib.getenv('DBUS_SESSION_BUS_ADDRESS')) {
    printerr('mockbus: DBUS_SYSTEM_BUS_ADDRESS must point at a private bus, refusing');
    System.exit(1);
}
const sys = Gio.bus_get_sync(Gio.BusType.SYSTEM, null);
const ses = Gio.bus_get_sync(Gio.BusType.SESSION, null);
systemServices(sys);
sessionServices(ses);
let pending = SYSTEM_NAMES.length + SESSION_NAMES.length;
const owned = () => {
    if (--pending === 0 && ready)
        GLib.file_set_contents(ready, 'ok');
};
for (const n of SYSTEM_NAMES)
    Gio.bus_own_name_on_connection(sys, n, Gio.BusNameOwnerFlags.NONE, owned, () => printerr(`lost ${n}`));
for (const n of SESSION_NAMES)
    Gio.bus_own_name_on_connection(ses, n, Gio.BusNameOwnerFlags.NONE, owned, () => printerr(`lost ${n}`));
new GLib.MainLoop(null, false).run();
