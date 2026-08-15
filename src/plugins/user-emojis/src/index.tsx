import { patcher } from "@vendetta";
import { findByProps, findByStoreName } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { FluxDispatcher, React, ReactNative as RN } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import { Forms } from "@vendetta/ui/components";
import { registerCommand } from "@vendetta/commands";
import { useProxy } from "@vendetta/storage";

// --- TYPES ---
export type CommandName = "e" | "ed" | "esync" | "deleteemoji" | "stealemoji" | "installpack" | "uninstallpack";

export interface CommandMeta { id: string; version: string; name: CommandName; }
export interface DiscoveredApp { appId: string; appName: string; commands: Partial<Record<CommandName, CommandMeta>>; }
export interface AppEmoji { id: string; name: string; animated: boolean; }
export interface EmojiPack { name: string; description?: string; iconUrl?: string; emojis: Record<string, string>; }

// --- CONSTANTS ---
const PLUGIN_TAG = "[UserEmojiPicker]";
const USER_PICKER_CATEGORY = "User App Emojis";
const REQUIRED_COMMANDS: CommandName[] = ["e", "ed", "esync", "deleteemoji", "stealemoji", "installpack", "uninstallpack"];
const emojiRegex = /<a?:([A-Za-z0-9_]+):(\d+)>/g;
const PACKS_URL = "https://raw.githubusercontent.com/MORGANlTE/selfhosted-user-emojis-for-free/refs/heads/main/vencord_plugin/packs_index.json";

// --- METRO RESOLVERS ---
const MessageActions = findByProps("sendMessage", "editMessage");
const RestAPI = findByProps("get", "post", "del");
const AuthenticationStore = findByStoreName("AuthenticationStore");
const SelectedGuildStore = findByStoreName("SelectedGuildStore");
const SelectedChannelStore = findByProps("getChannelId", "getVoiceChannelId");
const UserStore = findByStoreName("UserStore");
const GuildStore = findByStoreName("GuildStore");
const EmojiStore = findByStoreName("EmojiStore") || findByProps("getCustomEmojiById", "getEmojis");
const LazyActionSheet = findByProps("openLazy", "hideActionSheet");
const ComponentDispatch = findByProps("dispatchToLastSubscribed") || findByProps("dispatch");
const TextUtils = findByProps("insertText");

const { FormSection, FormSwitchRow, FormInput, FormRow } = Forms;
let unpatches: Function[] = [];

// --- HELPER PARSERS ---
function getEmojiCdnUrl(id: string) {
    // Discord CDN auto-detects animated/static without explicit extensions when no extension is passed.
    return `https://cdn.discordapp.com/emojis/${id}?size=64`;
}

function parseRawEmojiTag(rawTag: string) {
    if (!rawTag) return null;
    if (rawTag.startsWith("<") && rawTag.endsWith(">")) {
        const clean = rawTag.replace(/[<>]/g, "");
        const parts = clean.split(":");
        const isAnimated = parts[0] === "a";
        const name = parts.length > 2 ? parts[1] : parts[0];
        const id = parts[parts.length - 1];
        return { id, name, animated: isAnimated, url: getEmojiCdnUrl(id) };
    }
    if (rawTag.startsWith("http")) return { id: "", name: "", animated: false, url: rawTag };
    return null;
}

function buildEmojiObj(emoji: AppEmoji) {
    return {
        id: emoji.id,
        name: emoji.name,
        originalName: emoji.name,
        animated: Boolean(emoji.animated),
        available: true,
        managed: false,
        require_colons: true,
        roles: [],
        url: getEmojiCdnUrl(emoji.id),
        allNamesString: `:${emoji.name}:`,
        type: 3,
        category: USER_PICKER_CATEGORY,
        categoryName: USER_PICKER_CATEGORY,
        source: "discord",
        score: 2147483647,
        isLocked: false,
        locked: false,
        disabled: false,
        guildId: "UserAppEmojis",
    };
}

function logStatus(msg: string, isError = false) {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `${timestamp} ${msg}`;
    if (!storage.debugLogs) storage.debugLogs = [];
    storage.debugLogs.unshift(formatted);
    if (storage.debugLogs.length > 30) storage.debugLogs.pop();

    if (isError) console.error(`${PLUGIN_TAG} 🔴 ${msg}`);
    else console.log(`${PLUGIN_TAG} 🟢 ${msg}`);
}

export function getActiveApp(): DiscoveredApp | undefined {
    return (storage.apps || []).find((a: DiscoveredApp) => a.appId === storage.selectedAppId);
}

// --- CORE ACTIONS ---
export function openEmojiModal() {
    if (LazyActionSheet?.openLazy) {
        LazyActionSheet.openLazy(
            () => Promise.resolve((props: any) => (
                <EmojiStoreModal hideActionSheet={props?.hideActionSheet || LazyActionSheet.hideActionSheet} />
            )),
            "CustomEmojiStoreSheet"
        );
        logStatus("Opened Emoji Modal ActionSheet");
    } else {
        showToast(`${PLUGIN_TAG} ActionSheet unavailable`, 2);
    }
}

export function insertEmojiIntoDraft(emoji: AppEmoji, closeUI: () => void) {
    const tag = `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}> `;
    let inserted = false;

    try {
        if (ComponentDispatch?.dispatchToLastSubscribed) {
            ComponentDispatch.dispatchToLastSubscribed("INSERT_TEXT", { plainText: tag, rawText: tag });
            inserted = true;
        } else if (ComponentDispatch?.dispatch) {
            ComponentDispatch.dispatch("INSERT_TEXT", { plainText: tag, rawText: tag });
            inserted = true;
        } else if (TextUtils?.insertText) {
            TextUtils.insertText(tag);
            inserted = true;
        }
    } catch {}

    if (!inserted) {
        RN.Clipboard.setString(tag);
        showToast(`${PLUGIN_TAG} Copied :${emoji.name}:`, 1);
    }

    closeUI();
}

export async function dispatchAppCommand(cmdName: CommandName, channelId: string, options: any[] = []) {
    const app = getActiveApp();
    if (!app || !app.commands[cmdName]) return showToast(`${PLUGIN_TAG} /${cmdName} not found`, 2);

    try {
        await RestAPI.post({
            url: "/interactions",
            body: {
                type: 2,
                application_id: app.appId,
                guild_id: SelectedGuildStore?.getGuildId() || undefined,
                channel_id: channelId,
                session_id: AuthenticationStore.getSessionId(),
                data: { id: app.commands[cmdName]!.id, version: app.commands[cmdName]!.version, name: cmdName, type: 1, options },
                nonce: Date.now().toString(),
            },
        });
        showToast(`${PLUGIN_TAG} Sent /${cmdName}`, 1);
    } catch {
        showToast(`${PLUGIN_TAG} Failed /${cmdName}`, 2);
    }
}

export async function syncEmojisFromBot(manual = false) {
    try {
        if (!storage.selectedAppId) {
            const cmdData = await RestAPI.get({ url: "/users/@me/application-command-index" });
            const cmds = cmdData?.body?.application_commands || [];
            const appMap = new Map<string, DiscoveredApp>();

            for (const cmd of cmds) {
                const appId = String(cmd?.application_id ?? "");
                if (!appId) continue;
                const app = appMap.get(appId) ?? { appId, appName: cmd?.application?.name || "App", commands: {} };
                const name = String(cmd?.name ?? "").toLowerCase() as CommandName;
                if (REQUIRED_COMMANDS.includes(name)) app.commands[name] = { id: cmd.id, version: cmd.version, name };
                appMap.set(appId, app);
            }
            storage.apps = Array.from(appMap.values()).filter((a) => REQUIRED_COMMANDS.slice(0, 4).every((req) => Boolean(a.commands[req])));
            if (storage.apps.length > 0) storage.selectedAppId = storage.apps[0].appId;
        }

        const app = getActiveApp();
        if (!app || !app.commands.esync) return;

        const dmReq = await RestAPI.post({ url: "/users/@me/channels", body: { recipients: [app.appId] } });
        const dmChannelId = dmReq?.body?.id;
        if (!dmChannelId) return;

        const jsonPromise = new Promise<{ url: string; msgId: string }>((resolve, reject) => {
            const timeout = setTimeout(() => { FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMsg); reject(); }, 15000);
            function onMsg(e: any) {
                if (e?.message?.channel_id === dmChannelId && String(e?.message?.author?.id) === app.appId) {
                    const att = e.message.attachments?.find((a: any) => String(a?.filename).toLowerCase() === "emojis.json");
                    if (att?.url) {
                        clearTimeout(timeout);
                        FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMsg);
                        resolve({ url: att.url, msgId: e.message.id });
                    }
                }
            }
            FluxDispatcher.subscribe("MESSAGE_CREATE", onMsg);
        });

        await RestAPI.post({
            url: "/interactions",
            body: {
                type: 2, application_id: app.appId, channel_id: dmChannelId, session_id: AuthenticationStore.getSessionId(),
                data: { id: app.commands.esync.id, version: app.commands.esync.version, name: "esync", type: 1 },
                nonce: Date.now().toString(),
            },
        });

        const res = await jsonPromise;
        const data: AppEmoji[] = await (await fetch(res.url)).json();

        storage.emojis = data;
        logStatus(`Synced ${data.length} emojis.`);
        if (manual) showToast(`${PLUGIN_TAG} Synced ${data.length} emojis!`, 1);

        try { await RestAPI.del({ url: `/channels/${dmChannelId}/messages/${res.msgId}` }); } catch {}
    } catch {
        if (manual) showToast(`${PLUGIN_TAG} Sync failed`, 2);
    }
}

// --- EMOJI STORE MODAL ---
function EmojiStoreModal({ hideActionSheet }: { hideActionSheet?: () => void }) {
    const [tab, setTab] = React.useState<"emojis" | "market">("emojis");
    const [search, setSearch] = React.useState("");
    const [selectedPack, setSelectedPack] = React.useState("All");
    const [remotePacks, setRemotePacks] = React.useState<EmojiPack[]>([]);

    const emojis: AppEmoji[] = storage.emojis || [];

    React.useEffect(() => {
        if (tab === "market" && remotePacks.length === 0) {
            fetch(PACKS_URL).then((res) => res.json()).then((data) => setRemotePacks(Array.isArray(data) ? data : [])).catch(() => {});
        }
    }, [tab]);

    const packs = Array.from(new Set(emojis.map((e) => { const parts = e.name.split("_"); return parts.length > 1 ? parts[0] : "Other"; }))).sort();
    packs.unshift("All");

    const filteredEmojis = emojis.filter((e) => {
        if (!e.name.toLowerCase().includes(search.toLowerCase())) return false;
        if (selectedPack === "All") return true;
        const packName = e.name.split("_").length > 1 ? e.name.split("_")[0] : "Other";
        return packName.toLowerCase() === selectedPack.toLowerCase();
    });

    const closeUI = () => {
        if (hideActionSheet) hideActionSheet();
        if (LazyActionSheet?.hideActionSheet) LazyActionSheet.hideActionSheet();
    };

    return (
        <RN.View style={{ height: 380, maxHeight: 380, backgroundColor: "#1e1f22", borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 12, paddingTop: 10 }}>
            {/* Header */}
            <RN.View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: "rgba(255, 255, 255, 0.1)" }}>
                <RN.Text style={{ color: "#fff", fontSize: 16, fontWeight: "bold" }}>💎 Custom Emojis ({emojis.length})</RN.Text>
                <RN.View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <RN.TouchableOpacity onPress={() => syncEmojisFromBot(true)} style={{ padding: 4, backgroundColor: "rgba(88, 101, 242, 0.2)", borderRadius: 6 }}>
                        <RN.Text style={{ color: "#5865F2", fontSize: 11, fontWeight: "600" }}>Resync</RN.Text>
                    </RN.TouchableOpacity>
                    <RN.TouchableOpacity onPress={closeUI} hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }} style={{ backgroundColor: "rgba(255, 255, 255, 0.15)", borderRadius: 14, width: 28, height: 28, alignItems: "center", justifyContent: "center" }}>
                        <RN.Text style={{ color: "#fff", fontSize: 14, fontWeight: "bold" }}>✕</RN.Text>
                    </RN.TouchableOpacity>
                </RN.View>
            </RN.View>

            {/* Tabs */}
            <RN.View style={{ flexDirection: "row", paddingVertical: 8, gap: 8 }}>
                <RN.TouchableOpacity onPress={() => setTab("emojis")} style={{ paddingVertical: 6, paddingHorizontal: 16, backgroundColor: tab === "emojis" ? "#5865F2" : "rgba(255,255,255,0.06)", borderRadius: 8 }}>
                    <RN.Text style={{ color: "#fff", fontSize: 12, fontWeight: "bold" }}>Local</RN.Text>
                </RN.TouchableOpacity>
                <RN.TouchableOpacity onPress={() => setTab("market")} style={{ paddingVertical: 6, paddingHorizontal: 16, backgroundColor: tab === "market" ? "#5865F2" : "rgba(255,255,255,0.06)", borderRadius: 8 }}>
                    <RN.Text style={{ color: "#fff", fontSize: 12, fontWeight: "bold" }}>Market</RN.Text>
                </RN.TouchableOpacity>
            </RN.View>

            {/* Content */}
            {tab === "emojis" ? (
                <RN.View style={{ flex: 1 }}>
                    <RN.TextInput value={search} placeholder="Search emojis..." placeholderTextColor="#888" onChangeText={setSearch} style={{ backgroundColor: "rgba(0,0,0,0.3)", color: "#fff", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginBottom: 8 }} />
                    <RN.ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 30, marginBottom: 8 }}>
                        {packs.map((p) => (
                            <RN.TouchableOpacity key={p} onPress={() => setSelectedPack(p)} style={{ paddingHorizontal: 10, paddingVertical: 4, backgroundColor: selectedPack === p ? "#5865F2" : "rgba(255,255,255,0.08)", borderRadius: 10, marginRight: 6 }}>
                                <RN.Text style={{ color: "#fff", fontSize: 11 }}>{p}</RN.Text>
                            </RN.TouchableOpacity>
                        ))}
                    </RN.ScrollView>
                    <RN.ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="always">
                        <RN.View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 20 }}>
                            {filteredEmojis.map((emoji) => (
                                <RN.TouchableOpacity key={emoji.id} onPress={() => insertEmojiIntoDraft(emoji, closeUI)} style={{ alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 8, width: 44, height: 44 }}>
                                    <RN.Image source={{ uri: getEmojiCdnUrl(emoji.id) }} style={{ width: 32, height: 32 }} resizeMode="contain" />
                                </RN.TouchableOpacity>
                            ))}
                        </RN.View>
                    </RN.ScrollView>
                </RN.View>
            ) : (
                <RN.ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="always">
                    {remotePacks.map((pack) => {
                        const isInstalled = pack.emojis && Object.keys(pack.emojis).some((name) => emojis.some((e) => e.name.toLowerCase() === name.toLowerCase()));
                        const iconData = parseRawEmojiTag(pack.iconUrl || "");
                        return (
                            <RN.View key={pack.name} style={{ backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 10, padding: 12, marginBottom: 10 }}>
                                <RN.View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                                    <RN.View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                                        {iconData ? <RN.Image source={{ uri: iconData.url }} style={{ width: 36, height: 36, borderRadius: 8 }} resizeMode="contain" /> : <RN.Text style={{ fontSize: 24 }}>📦</RN.Text>}
                                        <RN.View style={{ flex: 1 }}>
                                            <RN.Text style={{ color: "#fff", fontSize: 14, fontWeight: "bold" }}>{pack.name.toUpperCase()}</RN.Text>
                                            <RN.Text style={{ color: "#aaa", fontSize: 11 }}>{pack.description || `${Object.keys(pack.emojis || {}).length} emojis`}</RN.Text>
                                        </RN.View>
                                    </RN.View>
                                    <RN.TouchableOpacity
                                        onPress={async () => {
                                            const channelId = SelectedChannelStore?.getChannelId();
                                            if (!channelId) return;
                                            await dispatchAppCommand(isInstalled ? "uninstallpack" : "installpack", channelId, [{ type: 3, name: "pack_name", value: pack.name }]);
                                            syncEmojisFromBot(false);
                                        }}
                                        style={{ backgroundColor: isInstalled ? "#ED4245" : "#5865F2", paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 }}
                                    >
                                        <RN.Text style={{ color: "#fff", fontSize: 11, fontWeight: "bold" }}>{isInstalled ? "Uninstall" : "Install"}</RN.Text>
                                    </RN.TouchableOpacity>
                                </RN.View>
                                <RN.View style={{ flexDirection: "row", gap: 4, backgroundColor: "rgba(0,0,0,0.25)", padding: 6, borderRadius: 6 }}>
                                    {Object.entries(pack.emojis || {}).slice(0, 10).map(([n, tag]) => {
                                        const parsed = parseRawEmojiTag(tag);
                                        return parsed ? <RN.Image key={n} source={{ uri: parsed.url }} style={{ width: 22, height: 22 }} resizeMode="contain" /> : null;
                                    })}
                                </RN.View>
                            </RN.View>
                        );
                    })}
                </RN.ScrollView>
            )}
        </RN.View>
    );
}

// --- SETTINGS VIEW ---
function Settings() {
    useProxy(storage);
    return (
        <RN.ScrollView style={{ flex: 1, padding: 12 }}>
            <FormSection title="Actions">
                <FormRow label="Open Emoji Store" onPress={openEmojiModal} />
                <FormRow label="Force Resync" subLabel={`${storage.emojis?.length || 0} cached`} onPress={() => syncEmojisFromBot(true)} />
            </FormSection>
            <FormSection title="Logs">
                {(storage.debugLogs || []).map((e: string, i: number) => <RN.Text key={i} style={{ color: "#aaa", fontSize: 11 }}>{e}</RN.Text>)}
            </FormSection>
        </RN.ScrollView>
    );
}

// --- MAIN LIFECYCLE ---
export default {
    settings: Settings,
    onLoad() {
        if (!storage.emojis) storage.emojis = [];
        if (!storage.apps) storage.apps = [];
        if (!storage.debugLogs) storage.debugLogs = [];
        if (storage.botPingToUserPing === undefined) storage.botPingToUserPing = true;

        logStatus("Initializing Universal Hooks...");

        // 1. Hook Autocomplete EmojiStore
        if (EmojiStore) {
            if (typeof EmojiStore.searchWithoutFetchingLatest === "function") {
                unpatches.push(patcher.instead("searchWithoutFetchingLatest", EmojiStore, (args, orig) => {
                    const result = orig.apply(EmojiStore, args) || {};
                    const query = String(args[0]?.query ?? "").toLowerCase();
                    const loaded: AppEmoji[] = storage.emojis || [];
                    if (!query || !loaded.length) return result;
                    
                    if (!Array.isArray(result.unlocked)) result.unlocked = [];
                    const existingIds = new Set(result.unlocked.map((e: any) => String(e?.id ?? "")));
                    
                    const customMatches = loaded.filter(e => e.name.toLowerCase().includes(query) && !existingIds.has(e.id)).map(buildEmojiObj);
                    if (customMatches.length) result.unlocked = [...customMatches, ...result.unlocked];
                    return result;
                }));
            }
            if (typeof EmojiStore.getCustomEmojiById === "function") {
                unpatches.push(patcher.instead("getCustomEmojiById", EmojiStore, (args, orig) => {
                    const found = (storage.emojis || []).find((e: AppEmoji) => e.id === args[0]);
                    return found ? buildEmojiObj(found) : orig.apply(EmojiStore, args);
                }));
            }
        }

        if (GuildStore?.getGuild) {
            unpatches.push(patcher.instead("getGuild", GuildStore, (args, orig) => args[0] === "UserAppEmojis" ? { id: "UserAppEmojis", name: USER_PICKER_CATEGORY, getIconURL: () => null } : orig.apply(GuildStore, args)));
        }

        // 2. Global FluxDispatcher Interceptor (Live Chat Bubble Rendering & Bot Pings)
        unpatches.push(patcher.instead("dispatch", FluxDispatcher, (args, orig) => {
            const [event] = args;
            if (event) {
                // A. Message Rendering Replacer
                if ((event.type === "MESSAGE_CREATE" || event.type === "MESSAGE_UPDATE") && event.message?.content && storage.emojis?.length) {
                    const emojiMap = new Map(storage.emojis.map((e: AppEmoji) => [e.name.toLowerCase(), e]));
                    event.message.content = event.message.content.replace(
                        /(?<!<a?:[A-Za-z0-9_]+:\d+)(?:;([A-Za-z0-9_]+);|:([A-Za-z0-9_]+):)/g,
                        (match: string, semi: string, colon: string) => {
                            const found = emojiMap.get((semi || colon || "").toLowerCase());
                            return found ? `<${found.animated ? "a" : ""}:${found.name}:${found.id}>` : match;
                        }
                    );
                }
                // B. Bot Ping Forwarder
                if ((event.type === "MESSAGE_CREATE" || event.type === "MESSAGE_UPDATE") && storage.botPingToUserPing && storage.selectedAppId) {
                    const msg = event.message;
                    const botId = storage.selectedAppId;
                    const cUser = UserStore?.getCurrentUser?.();
                    if (msg && cUser && (msg.referenced_message?.author?.id === botId || msg.mentions?.some((m: any) => m.id === botId))) {
                        if (!Array.isArray(msg.mentions)) msg.mentions = [];
                        if (!msg.mentions.some((m: any) => m.id === cUser.id)) msg.mentions.push(cUser);
                    }
                }
            }
            return orig.apply(FluxDispatcher, args);
        }));

        // 3. Outgoing Message Interceptor (/e Proxy)
        if (MessageActions) {
            unpatches.push(patcher.instead("sendMessage", MessageActions, async (args, orig) => {
                const [channelId, message] = args;
                if (message?.content && storage.emojis?.length) {
                    const emojiMap = new Map(storage.emojis.map((e: AppEmoji) => [e.name.toLowerCase(), e]));
                    let proxied = false;
                    const transformed = String(message.content).replace(emojiRegex, (match, tag) => {
                        const found = emojiMap.get(tag.toLowerCase());
                        if (found) { proxied = true; return `;${found.name};`; }
                        return match;
                    });
                    
                    if (proxied) {
                        const app = getActiveApp();
                        if (app?.commands.e) {
                            await RestAPI.post({
                                url: "/interactions",
                                body: { type: 2, application_id: app.appId, guild_id: SelectedGuildStore?.getGuildId() || undefined, channel_id: channelId, session_id: AuthenticationStore.getSessionId(), data: { id: app.commands.e.id, version: app.commands.e.version, name: "e", type: 1, options: [{ type: 3, name: "text", value: transformed }] }, nonce: Date.now().toString() }
                            });
                            return;
                        }
                    }
                }
                return orig.apply(MessageActions, args);
            }));
        }

        // 4. ActionSheet Hooks (Injects into + Attach Menu & Long Press Messages safely)
        if (LazyActionSheet?.openLazy) {
            unpatches.push(patcher.before("openLazy", LazyActionSheet, (args) => {
                const [thunk, key] = args;
                const isAttach = key && String(key).toLowerCase().includes("attach");
                const isContext = key && String(key).toLowerCase().includes("message");

                if (isAttach || isContext) {
                    logStatus(`Hooking ActionSheet: ${key}`);
                    
                    const patchModule = (rawModule: any) => {
                        const Component = rawModule?.default || rawModule;
                        if (typeof Component !== "function") return rawModule;

                        const PatchedComponent = (props: any) => {
                            const tree = Component(props);
                            if (!tree) return tree;

                            try {
                                const newElements = [];
                                const closeSheet = () => {
                                    if (props.hideActionSheet) props.hideActionSheet();
                                    if (LazyActionSheet.hideActionSheet) LazyActionSheet.hideActionSheet();
                                };

                                if (isAttach) {
                                    newElements.push(
                                        <RN.TouchableOpacity key="store-attach-btn" onPress={() => { closeSheet(); setTimeout(openEmojiModal, 200); }} style={{ padding: 14, flexDirection: "row", alignItems: "center", backgroundColor: "rgba(88, 101, 242, 0.15)", borderRadius: 10, marginHorizontal: 16, marginVertical: 6 }}>
                                            <RN.Text style={{ fontSize: 18, marginRight: 8 }}>💎</RN.Text>
                                            <RN.Text style={{ color: "#fff", fontWeight: "bold", fontSize: 15 }}>Custom Emoji Store</RN.Text>
                                        </RN.TouchableOpacity>
                                    );
                                }

                                if (isContext && props?.message) {
                                    const app = getActiveApp();
                                    const matches = Array.from(String(props.message.content || "").matchAll(emojiRegex));
                                    if (app && matches.length > 0) {
                                        matches.forEach(m => {
                                            newElements.push(
                                                <RN.TouchableOpacity key={`steal-${m[1]}`} onPress={() => { closeSheet(); dispatchAppCommand("stealemoji", props.message.channel_id, [{ type: 3, name: "emoji", value: m[0] }, { type: 3, name: "new_name", value: m[1] }]); }} style={{ padding: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "rgba(255, 255, 255, 0.08)", borderRadius: 10, marginHorizontal: 16, marginVertical: 4 }}>
                                                    <RN.Text style={{ color: "#fff", fontSize: 15, fontWeight: "bold" }}>Steal :{m[1]}:</RN.Text>
                                                    <RN.Text style={{ fontSize: 16 }}>📥</RN.Text>
                                                </RN.TouchableOpacity>
                                            );
                                        });
                                    }
                                }

                                if (newElements.length > 0) {
                                    if (Array.isArray(tree.props?.children)) tree.props.children.push(...newElements);
                                    else if (tree.props?.children?.props && Array.isArray(tree.props.children.props.children)) tree.props.children.props.children.push(...newElements); // Handle nested ScrollViews
                                    else if (tree.props?.children) tree.props.children = [tree.props.children, ...newElements];
                                }
                            } catch (e) { logStatus(`ActionSheet JSX Error: ${e}`, true); }
                            
                            return tree;
                        };

                        return rawModule?.default ? { ...rawModule, default: PatchedComponent } : PatchedComponent;
                    };

                    // Discord passes either a function returning a Promise, or a direct Promise.
                    if (typeof thunk === "function") {
                        args[0] = async (...callArgs: any[]) => {
                            try { return patchModule(await thunk(...callArgs)); } catch { return thunk(...callArgs); }
                        };
                    } else if (thunk instanceof Promise) {
                        args[0] = thunk.then(patchModule).catch(() => thunk);
                    }
                }
            }));
            logStatus("Registered LazyActionSheet Interceptor");
        }

        // 5. Fallback Slash Command
        try { unpatches.push(registerCommand({ name: "emojistore", displayName: "emojistore", description: "Open Emoji Store", displayDescription: "Open Emoji Store", options: [], execute: openEmojiModal })); } catch {}

        syncEmojisFromBot(false);
    },

    onUnload() {
        unpatches.forEach((unpatch) => { try { unpatch(); } catch {} });
        unpatches = [];
    },
};
