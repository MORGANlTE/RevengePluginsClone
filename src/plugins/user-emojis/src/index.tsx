import { patcher } from "@vendetta";
import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { FluxDispatcher, React, ReactNative as RN } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import { Forms } from "@vendetta/ui/components";
import { registerCommand } from "@vendetta/commands";
import { useProxy } from "@vendetta/storage";

// --- TYPES ---
export type CommandName = "e" | "ed" | "esync" | "deleteemoji" | "stealemoji" | "installpack" | "uninstallpack";

export interface CommandMeta {
    id: string;
    version: string;
    name: CommandName;
}

export interface DiscoveredApp {
    appId: string;
    appName: string;
    commands: Partial<Record<CommandName, CommandMeta>>;
}

export interface AppEmoji {
    id: string;
    name: string;
    animated: boolean;
}

export interface EmojiPack {
    name: string;
    description?: string;
    iconUrl?: string;
    emojis: Record<string, string>;
}

// --- CONSTANTS ---
const PLUGIN_TAG = "[UserEmojiPicker]";
const USER_PICKER_CATEGORY = "User App Emojis";
const REQUIRED_COMMANDS: CommandName[] = [
    "e",
    "ed",
    "esync",
    "deleteemoji",
    "stealemoji",
    "installpack",
    "uninstallpack",
];
const PACKS_URL =
    "https://raw.githubusercontent.com/MORGANlTE/selfhosted-user-emojis-for-free/refs/heads/main/vencord_plugin/packs_index.json";

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
const ModalActions = findByProps("popModal", "pushModal");
const ComponentDispatch = findByProps("dispatchToLastSubscribed") || findByProps("dispatch");
const TextUtils = findByProps("insertText");

const { FormSection, FormSwitchRow, FormInput, FormRow } = Forms;
let unpatches: Function[] = [];

// --- LOGGING ---
function logStatus(msg: string, isError = false) {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `[${timestamp}] ${msg}`;
    if (!storage.debugLogs) storage.debugLogs = [];
    storage.debugLogs.unshift(formatted);
    if (storage.debugLogs.length > 40) storage.debugLogs.pop();

    if (isError) console.error(`${PLUGIN_TAG} 🔴 ${msg}`);
    else console.log(`${PLUGIN_TAG} 🟢 ${msg}`);
}

// --- HELPERS ---
function getEmojiCdnUrl(id: string) {
    return `https://cdn.discordapp.com/emojis/${id}?size=64&quality=lossless`;
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

function buildEmojiTag(emoji: AppEmoji) {
    return `<${emoji.animated ? "a:" : ":"}${emoji.name}:${emoji.id}>`;
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

export function getActiveApp(): DiscoveredApp | undefined {
    return (storage.apps || []).find((a: DiscoveredApp) => a.appId === storage.selectedAppId);
}

// --- RIGOROUS STRING TRANSFORMS (NO NESTED REPLACEMENTS) ---
function encodeOutgoingText(content: string, emojis: AppEmoji[]): { text: string; shouldProxy: boolean } {
    if (!content || !emojis.length) return { text: content, shouldProxy: false };
    const emojiMap = new Map(emojis.map((e) => [e.name.toLowerCase(), e]));
    let shouldProxy = false;

    // Step 1: Replace raw Discord tags (<a:name:id> or <:name:id>)
    let result = content.replace(/<a?:([A-Za-z0-9_]+):\d+>/g, (match, name) => {
        const found = emojiMap.get(name.toLowerCase());
        if (found) {
            shouldProxy = true;
            return `;${found.name};`;
        }
        return match;
    });

    // Step 2: Replace semicolon shortcuts (;name;)
    result = result.replace(/;([A-Za-z0-9_]+);/g, (match, name) => {
        const found = emojiMap.get(name.toLowerCase());
        if (found) {
            shouldProxy = true;
            return `;${found.name};`;
        }
        return match;
    });

    // Step 3: Replace standalone :name: ONLY if not part of a Discord tag
    result = result.replace(/(?<!<a?):([A-Za-z0-9_]+):(?!\d+>)/g, (match, name) => {
        const found = emojiMap.get(name.toLowerCase());
        if (found) {
            shouldProxy = true;
            return `;${found.name};`;
        }
        return match;
    });

    return { text: result, shouldProxy };
}

function decodeIncomingText(content: string, emojis: AppEmoji[]): string {
    if (!content || !emojis.length || !content.includes(";")) return content;
    const emojiMap = new Map(emojis.map((e) => [e.name.toLowerCase(), e]));

    return content.replace(/;([A-Za-z0-9_]+);/g, (match, name) => {
        const found = emojiMap.get(name.toLowerCase());
        return found ? buildEmojiTag(found) : match;
    });
}

// --- MODAL AND DRAFT CONTROLLERS ---
export function closeEmojiModal() {
    try {
        if (LazyActionSheet?.hideActionSheet) LazyActionSheet.hideActionSheet();
        if (ModalActions?.popModal) ModalActions.popModal("CustomEmojiStoreSheet");
    } catch {}
}

export function openEmojiModal() {
    try {
        if (LazyActionSheet?.openLazy) {
            LazyActionSheet.openLazy(
                () =>
                    Promise.resolve({
                        default: (props: any) => (
                            <EmojiStoreModal hideActionSheet={props?.hideActionSheet || closeEmojiModal} />
                        ),
                    }),
                "CustomEmojiStoreSheet"
            );
            logStatus("Opened Emoji Store ActionSheet");
        } else {
            showToast(`${PLUGIN_TAG} ActionSheet unavailable`, 2);
        }
    } catch (e) {
        logStatus(`openEmojiModal error: ${String(e)}`, true);
    }
}

export function insertEmojiIntoDraft(emoji: AppEmoji, closeCallback?: () => void) {
    const tag = `${buildEmojiTag(emoji)} `;
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
        showToast(`${PLUGIN_TAG} Copied :${emoji.name}: to clipboard`, 1);
    }

    if (closeCallback) closeCallback();
    else closeEmojiModal();
}

// --- BOT API DISPATCHER & SYNC ---
export async function dispatchAppCommand(cmdName: CommandName, channelId: string, options: any[] = []) {
    const app = getActiveApp();
    if (!app || !app.commands[cmdName]) {
        showToast(`${PLUGIN_TAG} Command /${cmdName} not found`, 2);
        return;
    }

    try {
        await RestAPI.post({
            url: "/interactions",
            body: {
                type: 2,
                application_id: app.appId,
                guild_id: SelectedGuildStore?.getGuildId() || undefined,
                channel_id: channelId,
                session_id: AuthenticationStore.getSessionId(),
                data: {
                    id: cmd.id,
                    version: cmd.version,
                    name: cmd.name,
                    type: 1,
                    options,
                },
                nonce: Date.now().toString(),
            },
        });
        showToast(`${PLUGIN_TAG} Sent /${cmdName}`, 1);
    } catch (err) {
        showToast(`${PLUGIN_TAG} Failed /${cmdName}`, 2);
        logStatus(`Dispatch error: ${String(err)}`, true);
    }
}

export async function syncEmojisFromBot(manual = false) {
    try {
        logStatus("Starting emoji synchronization...");
        if (!storage.selectedAppId) {
            const cmdData = await RestAPI.get({ url: "/users/@me/application-command-index" });
            const cmds = cmdData?.body?.application_commands || [];
            const appMap = new Map<string, DiscoveredApp>();

            for (const cmd of cmds) {
                const appId = String(cmd?.application_id ?? "");
                if (!appId) continue;
                const app = appMap.get(appId) ?? { appId, appName: cmd?.application?.name || "App", commands: {} };
                const name = String(cmd?.name ?? "").toLowerCase() as CommandName;
                if (REQUIRED_COMMANDS.includes(name)) {
                    app.commands[name] = { id: cmd.id, version: cmd.version, name };
                }
                appMap.set(appId, app);
            }

            storage.apps = Array.from(appMap.values()).filter((a) =>
                REQUIRED_COMMANDS.slice(0, 4).every((req) => Boolean(a.commands[req]))
            );

            if (storage.apps.length > 0) storage.selectedAppId = storage.apps[0].appId;
        }

        const app = getActiveApp();
        if (!app || !app.commands.esync) return;

        const dmReq = await RestAPI.post({ url: "/users/@me/channels", body: { recipients: [app.appId] } });
        const dmChannelId = dmReq?.body?.id;
        if (!dmChannelId) return;

        const jsonPromise = new Promise<{ url: string; msgId: string }>((resolve, reject) => {
            const timeout = setTimeout(() => {
                FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMsg);
                reject(new Error("Sync timeout"));
            }, 15000);

            function onMsg(e: any) {
                if (e?.message?.channel_id === dmChannelId && String(e?.message?.author?.id) === app.appId) {
                    const att = e.message.attachments?.find((a: any) =>
                        String(a?.filename).toLowerCase() === "emojis.json"
                    );
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
                type: 2,
                application_id: app.appId,
                channel_id: dmChannelId,
                session_id: AuthenticationStore.getSessionId(),
                data: {
                    id: app.commands.esync.id,
                    version: app.commands.esync.version,
                    name: "esync",
                    type: 1,
                },
                nonce: Date.now().toString(),
            },
        });

        const res = await jsonPromise;
        const data: AppEmoji[] = await (await fetch(res.url)).json();
        storage.emojis = data;
        logStatus(`Synced ${data.length} emojis.`);
        if (manual) showToast(`${PLUGIN_TAG} Synced ${data.length} emojis!`, 1);

        try {
            await RestAPI.del({ url: `/channels/${dmChannelId}/messages/${res.msgId}` });
        } catch {}
    } catch (e) {
        logStatus(`Sync error: ${String(e)}`, true);
        if (manual) showToast(`${PLUGIN_TAG} Sync failed`, 2);
    }
}

// --- EMOJI STORE MODAL ---
function EmojiStoreModal({ hideActionSheet }: { hideActionSheet?: () => void }) {
    const [tab, setTab] = React.useState<"emojis" | "market">("emojis");
    const [search, setSearch] = React.useState("");
    const [selectedPack, setSelectedPack] = React.useState("All");
    const [remotePacks, setRemotePacks] = React.useState<EmojiPack[]>([]);
    const [loadingPacks, setLoadingPacks] = React.useState(false);

    const emojis: AppEmoji[] = storage.emojis || [];

    React.useEffect(() => {
        if (tab === "market" && remotePacks.length === 0) {
            setLoadingPacks(true);
            fetch(PACKS_URL)
                .then((res) => res.json())
                .then((data) => setRemotePacks(Array.isArray(data) ? data : []))
                .catch(() => {})
                .finally(() => setLoadingPacks(false));
        }
    }, [tab]);

    const packs = Array.from(
        new Set(
            emojis.map((e) => {
                const parts = e.name.split("_");
                return parts.length > 1 ? parts[0] : "Other";
            })
        )
    ).sort();
    packs.unshift("All");

    const filteredEmojis = emojis.filter((e) => {
        const matchesSearch = e.name.toLowerCase().includes(search.toLowerCase());
        if (!matchesSearch) return false;
        if (selectedPack === "All") return true;
        const packName = e.name.split("_").length > 1 ? e.name.split("_")[0] : "Other";
        return packName.toLowerCase() === selectedPack.toLowerCase();
    });

    const closeHandler = () => {
        if (hideActionSheet) hideActionSheet();
        closeEmojiModal();
    };

    return (
        <RN.View
            style={{
                height: 380,
                maxHeight: 380,
                backgroundColor: "#1e1f22",
                borderTopLeftRadius: 18,
                borderTopRightRadius: 18,
                paddingHorizontal: 12,
                paddingTop: 10,
                paddingBottom: 14,
            }}
        >
            <RN.View
                style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingBottom: 8,
                    borderBottomWidth: 1,
                    borderBottomColor: "rgba(255, 255, 255, 0.1)",
                }}
            >
                <RN.View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <RN.Text style={{ fontSize: 16 }}>💎</RN.Text>
                    <RN.Text style={{ color: "#fff", fontSize: 14, fontWeight: "bold" }}>
                        Custom Emojis ({emojis.length})
                    </RN.Text>
                </RN.View>

                <RN.View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <RN.TouchableOpacity
                        onPress={() => syncEmojisFromBot(true)}
                        style={{
                            paddingVertical: 3,
                            paddingHorizontal: 8,
                            backgroundColor: "rgba(88, 101, 242, 0.2)",
                            borderRadius: 6,
                        }}
                    >
                        <RN.Text style={{ color: "#5865F2", fontSize: 11, fontWeight: "600" }}>Resync</RN.Text>
                    </RN.TouchableOpacity>

                    <RN.TouchableOpacity
                        onPress={closeHandler}
                        hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
                        style={{
                            backgroundColor: "rgba(255, 255, 255, 0.15)",
                            borderRadius: 14,
                            width: 28,
                            height: 28,
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <RN.Text style={{ color: "#fff", fontSize: 13, fontWeight: "bold" }}>✕</RN.Text>
                    </RN.TouchableOpacity>
                </RN.View>
            </RN.View>

            <RN.View style={{ flexDirection: "row", paddingVertical: 8, gap: 8 }}>
                <RN.TouchableOpacity
                    onPress={() => setTab("emojis")}
                    style={{
                        paddingVertical: 5,
                        paddingHorizontal: 16,
                        backgroundColor: tab === "emojis" ? "#5865F2" : "rgba(255,255,255,0.06)",
                        borderRadius: 8,
                    }}
                >
                    <RN.Text style={{ color: "#fff", fontSize: 12, fontWeight: "bold" }}>Local</RN.Text>
                </RN.TouchableOpacity>
                <RN.TouchableOpacity
                    onPress={() => setTab("market")}
                    style={{
                        paddingVertical: 5,
                        paddingHorizontal: 16,
                        backgroundColor: tab === "market" ? "#5865F2" : "rgba(255,255,255,0.06)",
                        borderRadius: 8,
                    }}
                >
                    <RN.Text style={{ color: "#fff", fontSize: 12, fontWeight: "bold" }}>Market</RN.Text>
                </RN.TouchableOpacity>
            </RN.View>

            {tab === "emojis" ? (
                <RN.View style={{ flex: 1 }}>
                    <RN.TextInput
                        value={search}
                        placeholder="Search emojis..."
                        placeholderTextColor="#888"
                        onChangeText={setSearch}
                        style={{
                            backgroundColor: "rgba(0,0,0,0.3)",
                            color: "#fff",
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            borderRadius: 8,
                            fontSize: 12,
                            marginBottom: 8,
                        }}
                    />

                    {packs.length > 2 && (
                        <RN.ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 28, marginBottom: 8 }}>
                            {packs.map((p) => (
                                <RN.TouchableOpacity
                                    key={p}
                                    onPress={() => setSelectedPack(p)}
                                    style={{
                                        paddingHorizontal: 10,
                                        paddingVertical: 3,
                                        backgroundColor: selectedPack === p ? "#5865F2" : "rgba(255,255,255,0.08)",
                                        borderRadius: 10,
                                        marginRight: 6,
                                    }}
                                >
                                    <RN.Text style={{ color: "#fff", fontSize: 11 }}>{p}</RN.Text>
                                </RN.TouchableOpacity>
                            ))}
                        </RN.ScrollView>
                    )}

                    <RN.ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="always">
                        <RN.View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingBottom: 14 }}>
                            {filteredEmojis.map((emoji) => (
                                <RN.TouchableOpacity
                                    key={emoji.id}
                                    onPress={() => insertEmojiIntoDraft(emoji, closeHandler)}
                                    style={{
                                        alignItems: "center",
                                        justifyContent: "center",
                                        backgroundColor: "rgba(255,255,255,0.05)",
                                        borderRadius: 8,
                                        width: 44,
                                        height: 44,
                                    }}
                                >
                                    <RN.Image
                                        source={{ uri: getEmojiCdnUrl(emoji.id) }}
                                        style={{ width: 32, height: 32 }}
                                        resizeMode="contain"
                                    />
                                </RN.TouchableOpacity>
                            ))}
                        </RN.View>
                    </RN.ScrollView>
                </RN.View>
            ) : (
                <RN.ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="always">
                    {loadingPacks && (
                        <RN.Text style={{ color: "#aaa", textAlign: "center", marginTop: 14 }}>Loading remote packs...</RN.Text>
                    )}
                    {remotePacks.map((pack) => {
                        const isInstalled =
                            pack.emojis &&
                            Object.keys(pack.emojis).some((name) =>
                                emojis.some((e) => e.name.toLowerCase() === name.toLowerCase())
                            );
                        const iconData = parseRawEmojiTag(pack.iconUrl || "");
                        const entries = Object.entries(pack.emojis || {});

                        return (
                            <RN.View key={pack.name} style={{ backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 10, padding: 10, marginBottom: 10 }}>
                                <RN.View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                                    <RN.View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                                        {iconData ? (
                                            <RN.Image source={{ uri: iconData.url }} style={{ width: 32, height: 32, borderRadius: 6 }} resizeMode="contain" />
                                        ) : (
                                            <RN.Text style={{ fontSize: 22 }}>📦</RN.Text>
                                        )}
                                        <RN.View style={{ flex: 1 }}>
                                            <RN.Text style={{ color: "#fff", fontSize: 13, fontWeight: "bold" }}>
                                                {pack.name.toUpperCase()}
                                            </RN.Text>
                                            <RN.Text style={{ color: "#aaa", fontSize: 11 }}>
                                                {pack.description || `${entries.length} emojis`}
                                            </RN.Text>
                                        </RN.View>
                                    </RN.View>

                                    <RN.TouchableOpacity
                                        onPress={async () => {
                                            const channelId = SelectedChannelStore?.getChannelId();
                                            if (!channelId) return;
                                            await dispatchAppCommand(
                                                isInstalled ? "uninstallpack" : "installpack",
                                                channelId,
                                                [{ type: 3, name: "pack_name", value: pack.name }]
                                            );
                                            syncEmojisFromBot(false);
                                        }}
                                        style={{
                                            backgroundColor: isInstalled ? "#ED4245" : "#5865F2",
                                            paddingVertical: 5,
                                            paddingHorizontal: 12,
                                            borderRadius: 6,
                                        }}
                                    >
                                        <RN.Text style={{ color: "#fff", fontSize: 11, fontWeight: "bold" }}>
                                            {isInstalled ? "Uninstall" : "Install"}
                                        </RN.Text>
                                    </RN.TouchableOpacity>
                                </RN.View>

                                <RN.View style={{ flexDirection: "row", gap: 4, backgroundColor: "rgba(0,0,0,0.25)", padding: 6, borderRadius: 6 }}>
                                    {entries.slice(0, 10).map(([n, tag]) => {
                                        const parsed = parseRawEmojiTag(tag);
                                        return parsed ? (
                                            <RN.Image key={n} source={{ uri: parsed.url }} style={{ width: 22, height: 22 }} resizeMode="contain" />
                                        ) : null;
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
                <FormRow
                    label="Force Resync"
                    subLabel={`${storage.emojis?.length || 0} cached`}
                    onPress={() => syncEmojisFromBot(true)}
                />
            </FormSection>
            <FormSection title="Configuration">
                <FormInput
                    title="User App ID"
                    value={storage.selectedAppId || ""}
                    placeholder="Enter Application ID"
                    onChange={(val: string) => {
                        storage.selectedAppId = val.trim();
                    }}
                />
                <FormSwitchRow
                    label="Bot Ping -> User Ping"
                    subLabel="Notify when bot is mentioned"
                    value={storage.botPingToUserPing ?? true}
                    onValueChange={(val: boolean) => {
                        storage.botPingToUserPing = val;
                    }}
                />
            </FormSection>
            <FormSection title="Logs">
                {(storage.debugLogs || []).map((e: string, i: number) => (
                    <RN.Text key={i} style={{ color: "#aaa", fontSize: 11, marginVertical: 1 }}>
                        {e}
                    </RN.Text>
                ))}
            </FormSection>
        </RN.ScrollView>
    );
}

// --- ACTIONSHEET MODULE FACTORY WRAPPER ---
function wrapActionSheetModule(OriginalModule: any, isAttach: boolean) {
    const Component = OriginalModule?.default ?? OriginalModule;
    if (typeof Component !== "function") return OriginalModule;

    function PatchedActionSheet(props: any) {
        let res: any;
        try {
            res = Component(props);
        } catch {
            return null;
        }

        if (!res || !React.isValidElement(res)) return res;

        try {
            const message = props?.message;
            const itemsToAdd: React.ReactNode[] = [];

            // Context Menu: Steal Emoji
            if (message && message.content) {
                const matches = Array.from(String(message.content).matchAll(/<a?:([A-Za-z0-9_]+):(\d+)>/g));
                const app = getActiveApp();

                if (app && matches.length > 0) {
                    matches.forEach((m) => {
                        const rawEmoji = m[0];
                        const emojiName = m[1];
                        itemsToAdd.push(
                            <RN.TouchableOpacity
                                key={`steal-${emojiName}-${m.index}`}
                                onPress={() => {
                                    if (props.hideActionSheet) props.hideActionSheet();
                                    closeEmojiModal();
                                    dispatchAppCommand("stealemoji", message.channel_id, [
                                        { type: 3, name: "emoji", value: rawEmoji },
                                        { type: 3, name: "new_name", value: emojiName },
                                    ]);
                                }}
                                style={{
                                    paddingVertical: 14,
                                    paddingHorizontal: 16,
                                    flexDirection: "row",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    backgroundColor: "rgba(255, 255, 255, 0.08)",
                                    borderRadius: 12,
                                    marginHorizontal: 12,
                                    marginVertical: 4,
                                }}
                            >
                                <RN.Text style={{ color: "#ffffff", fontSize: 15, fontWeight: "600" }}>
                                    Steal :{emojiName}:
                                </RN.Text>
                                <RN.Text style={{ fontSize: 16 }}>📥</RN.Text>
                            </RN.TouchableOpacity>
                        );
                    });
                }
            }

            // Attach (+) Menu: Emoji Store Action
            if (isAttach || (!message && (props?.onSelectFile || props?.channel))) {
                itemsToAdd.push(
                    <RN.TouchableOpacity
                        key="open-emoji-store-action"
                        onPress={() => {
                            if (props.hideActionSheet) props.hideActionSheet();
                            closeEmojiModal();
                            setTimeout(openEmojiModal, 250);
                        }}
                        style={{
                            paddingVertical: 14,
                            paddingHorizontal: 16,
                            flexDirection: "row",
                            alignItems: "center",
                            backgroundColor: "rgba(88, 101, 242, 0.15)",
                            borderRadius: 12,
                            marginHorizontal: 12,
                            marginVertical: 6,
                        }}
                    >
                        <RN.Text style={{ fontSize: 18, marginRight: 10 }}>💎</RN.Text>
                        <RN.Text style={{ color: "#ffffff", fontSize: 15, fontWeight: "bold" }}>
                            Custom Emoji Store
                        </RN.Text>
                    </RN.TouchableOpacity>
                );
            }

            if (itemsToAdd.length === 0) return res;

            const childrenArray = React.Children.toArray(res.props?.children);
            const newChildren = isAttach
                ? [...itemsToAdd, ...childrenArray]
                : [...childrenArray, ...itemsToAdd];

            return React.cloneElement(res, undefined, ...newChildren);
        } catch {
            return res;
        }
    }

    // Preserve module exports to satisfy Metro/Revenge module loader
    PatchedActionSheet.default = PatchedActionSheet;
    return typeof OriginalModule === "object" ? { ...OriginalModule, default: PatchedActionSheet } : PatchedActionSheet;
}

// --- MAIN LIFECYCLE ---
export default {
    settings: Settings,
    onLoad() {
        if (!storage.emojis) storage.emojis = [];
        if (!storage.apps) storage.apps = [];
        if (!storage.debugLogs) storage.debugLogs = [];
        if (storage.botPingToUserPing === undefined) storage.botPingToUserPing = true;

        logStatus("Initializing hooks...");

        // 1. Autocomplete Search & Usability
        if (EmojiStore) {
            if (typeof EmojiStore.searchWithoutFetchingLatest === "function") {
                unpatches.push(
                    patcher.instead("searchWithoutFetchingLatest", EmojiStore, (args, orig) => {
                        const result = orig.apply(EmojiStore, args) || {};
                        const query = String(args[0]?.query ?? "").toLowerCase();
                        const loaded: AppEmoji[] = storage.emojis || [];
                        if (!query || !loaded.length) return result;

                        if (!Array.isArray(result.unlocked)) result.unlocked = [];
                        const existingIds = new Set(result.unlocked.map((e: any) => String(e?.id ?? "")));

                        const customMatches = loaded
                            .filter((e) => e.name.toLowerCase().includes(query) && !existingIds.has(e.id))
                            .map(buildEmojiObj);

                        if (customMatches.length) {
                            result.unlocked = [...customMatches, ...result.unlocked];
                        }
                        return result;
                    })
                );
            }

            if (typeof EmojiStore.getCustomEmojiById === "function") {
                unpatches.push(
                    patcher.instead("getCustomEmojiById", EmojiStore, (args, orig) => {
                        const found = (storage.emojis || []).find((e: AppEmoji) => e.id === args[0]);
                        return found ? buildEmojiObj(found) : orig.apply(EmojiStore, args);
                    })
                );
            }
        }

        if (GuildStore?.getGuild) {
            unpatches.push(
                patcher.instead("getGuild", GuildStore, (args, orig) =>
                    args[0] === "UserAppEmojis"
                        ? { id: "UserAppEmojis", name: USER_PICKER_CATEGORY, getIconURL: () => null }
                        : orig.apply(GuildStore, args)
                )
            );
        }

        // 2. FluxDispatcher Interceptor (Chat Bubble Decoding & Bot Mentions)
        unpatches.push(
            patcher.instead("dispatch", FluxDispatcher, (args, orig) => {
                const [event] = args;
                if (event) {
                    if (
                        (event.type === "MESSAGE_CREATE" || event.type === "MESSAGE_UPDATE") &&
                        event.message?.content &&
                        storage.emojis?.length
                    ) {
                        event.message.content = decodeIncomingText(event.message.content, storage.emojis);
                    }

                    if (
                        (event.type === "MESSAGE_CREATE" || event.type === "MESSAGE_UPDATE") &&
                        storage.botPingToUserPing &&
                        storage.selectedAppId
                    ) {
                        const msg = event.message;
                        const botId = storage.selectedAppId;
                        const cUser = UserStore?.getCurrentUser?.();
                        if (
                            msg &&
                            cUser &&
                            (msg.referenced_message?.author?.id === botId ||
                                msg.mentions?.some((m: any) => m.id === botId))
                        ) {
                            if (!Array.isArray(msg.mentions)) msg.mentions = [];
                            if (!msg.mentions.some((m: any) => m.id === cUser.id)) msg.mentions.push(cUser);
                        }
                    }
                }
                return orig.apply(FluxDispatcher, args);
            })
        );

        // 3. Outgoing Message Proxying (/e Interaction)
        if (MessageActions) {
            unpatches.push(
                patcher.instead("sendMessage", MessageActions, async (args, orig) => {
                    const [channelId, message] = args;
                    if (message?.content && storage.emojis?.length) {
                        const { text, shouldProxy } = encodeOutgoingText(message.content, storage.emojis);

                        if (shouldProxy) {
                            const app = getActiveApp();
                            if (app?.commands.e) {
                                await RestAPI.post({
                                    url: "/interactions",
                                    body: {
                                        type: 2,
                                        application_id: app.appId,
                                        guild_id: SelectedGuildStore?.getGuildId() || undefined,
                                        channel_id: channelId,
                                        session_id: AuthenticationStore.getSessionId(),
                                        data: {
                                            id: app.commands.e.id,
                                            version: app.commands.e.version,
                                            name: "e",
                                            type: 1,
                                            options: [{ type: 3, name: "text", value: text }],
                                        },
                                        nonce: Date.now().toString(),
                                    },
                                });
                                return;
                            }
                        }
                    }
                    return orig.apply(MessageActions, args);
                })
            );
        }

        // 4. ActionSheet Interceptor (Steal Emoji + Attach Menu)
        if (LazyActionSheet?.openLazy) {
            unpatches.push(
                patcher.before("openLazy", LazyActionSheet, (args) => {
                    const [thunk, key] = args;
                    const keyStr = String(key || "").toLowerCase();
                    const isAttach = keyStr.includes("attach");

                    if (typeof thunk === "function") {
                        args[0] = async (...callArgs: any[]) => {
                            try {
                                const rawModule = await thunk(...callArgs);
                                return wrapActionSheetModule(rawModule, isAttach);
                            } catch {
                                return thunk(...callArgs);
                            }
                        };
                    } else if (thunk instanceof Promise) {
                        args[0] = thunk
                            .then((rawModule) => wrapActionSheetModule(rawModule, isAttach))
                            .catch(() => thunk);
                    }
                })
            );
        }

        // 5. Floating Action Button (FAB) Injection
        const chatTargets = [
            findByName("MessagesWrapper", false),
            findByName("Chat", false),
            findByName("ChannelChat", false),
            findByProps("MessagesWrapper"),
        ].filter(Boolean);

        for (const target of chatTargets) {
            try {
                const fn = typeof target === "function" ? null : target.default ? "default" : Object.keys(target).find((k) => typeof target[k] === "function");
                const prop = fn || target;

                if (typeof target[prop] === "function") {
                    unpatches.push(
                        patcher.after(prop, target, (_, res) => {
                            if (!res || !res.props) return res;

                            const fab = (
                                <RN.TouchableOpacity
                                    key="user-emoji-store-fab"
                                    onPress={openEmojiModal}
                                    activeOpacity={0.8}
                                    style={{
                                        position: "absolute",
                                        right: 14,
                                        bottom: 74,
                                        width: 42,
                                        height: 42,
                                        borderRadius: 21,
                                        backgroundColor: "#5865F2",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        elevation: 8,
                                        zIndex: 9999,
                                        shadowColor: "#000",
                                        shadowOffset: { width: 0, height: 2 },
                                        shadowOpacity: 0.35,
                                        shadowRadius: 4,
                                    }}
                                >
                                    <RN.Text style={{ fontSize: 20 }}>💎</RN.Text>
                                </RN.TouchableOpacity>
                            );

                            const children = res.props.children;
                            if (Array.isArray(children)) {
                                if (!children.some((c: any) => c?.key === "user-emoji-store-fab")) {
                                    children.push(fab);
                                }
                            } else if (children) {
                                res.props.children = [children, fab];
                            }
                            return res;
                        })
                    );
                }
            } catch {}
        }

        // 6. Slash Command Fallback
        try {
            unpatches.push(
                registerCommand({
                    name: "emojistore",
                    displayName: "emojistore",
                    description: "Open Emoji Store",
                    displayDescription: "Open Emoji Store",
                    options: [],
                    execute: openEmojiModal,
                })
            );
        } catch {}

        syncEmojisFromBot(false);
        logStatus("Plugin loaded.");
    },

    onUnload() {
        for (const unpatch of unpatches) {
            try {
                if (typeof unpatch === "function") unpatch();
            } catch {}
        }
        unpatches = [];
        logStatus("Plugin unloaded.");
    },
};
