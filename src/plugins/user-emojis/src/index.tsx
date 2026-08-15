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
const emojiRegex = /<a?:([A-Za-z0-9_]+):(\d+)>/g;
const PACKS_URL =
    "https://raw.githubusercontent.com/MORGANlTE/selfhosted-user-emojis-for-free/refs/heads/main/vencord_plugin/packs_index.json";

// --- METRO MODULE RESOLVERS ---
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
const RowManager = findByProps("createRowFromMessage", "generateRows");
const DraftStore = findByStoreName("DraftStore");
const DraftActions = findByProps("setDraft", "saveDraft");
const ComponentDispatch = findByProps("dispatchToLastSubscribed");

const { FormSection, FormSwitchRow, FormInput, FormRow } = Forms;
let unpatches: Function[] = [];

// --- IN-APP LOGGER ---
function logStatus(msg: string, isError = false) {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `${timestamp} ${msg}`;
    if (!storage.debugLogs) storage.debugLogs = [];
    storage.debugLogs.unshift(formatted);
    if (storage.debugLogs.length > 30) storage.debugLogs.pop();

    if (isError) {
        console.error(`${PLUGIN_TAG} 🔴 ${msg}`);
    } else {
        console.log(`${PLUGIN_TAG} 🟢 ${msg}`);
    }
}

export function getActiveApp(): DiscoveredApp | undefined {
    return (storage.apps || []).find((a: DiscoveredApp) => a.appId === storage.selectedAppId);
}

// Builds an internal Discord Emoji Object compatible with Autocomplete & Chat
function buildEmojiObj(emoji: AppEmoji) {
    const ext = emoji.animated ? "gif" : "png";
    return {
        id: emoji.id,
        name: emoji.name,
        originalName: emoji.name,
        animated: emoji.animated,
        available: true,
        managed: false,
        require_colons: true,
        roles: [],
        url: `https://cdn.discordapp.com/emojis/${emoji.id}.${ext}?size=48&quality=lossless`,
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

export function closeEmojiModal() {
    try {
        if (LazyActionSheet?.hideActionSheet) {
            LazyActionSheet.hideActionSheet();
        }
        if (ModalActions?.popModal) {
            ModalActions.popModal("CustomEmojiStoreSheet");
        }
    } catch {}
}

export function openEmojiModal() {
    try {
        if (LazyActionSheet?.openLazy) {
            LazyActionSheet.openLazy(
                async () => () => <EmojiStoreModal />,
                "CustomEmojiStoreSheet"
            );
        } else {
            showToast(`${PLUGIN_TAG} ActionSheet module unavailable`, 2);
        }
    } catch (e) {
        logStatus(`openEmojiModal error: ${e}`, true);
    }
}

// Inserts emoji tag directly into the chat bar draft
export function insertEmojiIntoDraft(emoji: AppEmoji) {
    const channelId = SelectedChannelStore?.getChannelId();
    if (!channelId) {
        showToast(`${PLUGIN_TAG} No active channel`, 2);
        return;
    }

    const tag = `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;

    try {
        if (ComponentDispatch?.dispatchToLastSubscribed) {
            ComponentDispatch.dispatchToLastSubscribed("INSERT_TEXT", {
                plainText: tag + " ",
                rawText: tag + " ",
            });
            closeEmojiModal();
            return;
        }

        if (DraftActions && DraftStore) {
            const currentDraft = DraftStore.getDraft(channelId, 0) || "";
            const updated = currentDraft ? `${currentDraft} ${tag} ` : `${tag} `;
            if (typeof DraftActions.saveDraft === "function") {
                DraftActions.saveDraft(channelId, updated, 0);
            } else if (typeof DraftActions.setDraft === "function") {
                DraftActions.setDraft(channelId, updated, 0);
            }
            closeEmojiModal();
            return;
        }

        RN.Clipboard.setString(tag);
        showToast(`${PLUGIN_TAG} Copied :${emoji.name}: to clipboard`, 1);
        closeEmojiModal();
    } catch {
        RN.Clipboard.setString(tag);
        showToast(`${PLUGIN_TAG} Copied :${emoji.name}: to clipboard`, 1);
        closeEmojiModal();
    }
}

export async function dispatchAppCommand(cmdName: CommandName, channelId: string, options: any[] = []) {
    const app = getActiveApp();
    if (!app || !app.commands[cmdName]) {
        showToast(`${PLUGIN_TAG} Command /${cmdName} not found`, 2);
        return;
    }

    const guildId = SelectedGuildStore?.getGuildId() || undefined;
    const cmd = app.commands[cmdName]!;

    try {
        await RestAPI.post({
            url: "/interactions",
            body: {
                type: 2,
                application_id: app.appId,
                guild_id: guildId,
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
    } catch {
        showToast(`${PLUGIN_TAG} Failed /${cmdName}`, 2);
    }
}

export async function syncEmojisFromBot(manual = false) {
    try {
        logStatus("Syncing emojis from bot...");
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

            if (storage.apps.length > 0) {
                storage.selectedAppId = storage.apps[0].appId;
            }
        }

        const app = getActiveApp();
        if (!app || !app.commands.esync) return;

        const dmReq = await RestAPI.post({
            url: "/users/@me/channels",
            body: { recipients: [app.appId] },
        });
        const dmChannelId = dmReq?.body?.id;
        if (!dmChannelId) return;

        const jsonPromise = new Promise<{ url: string; msgId: string }>((resolve, reject) => {
            const timeout = setTimeout(() => {
                FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMsg);
                reject(new Error("Timeout"));
            }, 15000);

            function onMsg(e: any) {
                const msg = e?.message;
                if (msg?.channel_id === dmChannelId && String(msg?.author?.id) === app.appId) {
                    const att = msg?.attachments?.find((a: any) =>
                        String(a?.filename).toLowerCase() === "emojis.json"
                    );
                    if (att?.url) {
                        clearTimeout(timeout);
                        FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMsg);
                        resolve({ url: att.url, msgId: msg.id });
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
        const emojisReq = await fetch(res.url);
        const data: AppEmoji[] = await emojisReq.json();

        storage.emojis = data;
        logStatus(`Synced ${data.length} emojis.`);
        if (manual) showToast(`${PLUGIN_TAG} Synced ${data.length} emojis!`, 1);

        try {
            await RestAPI.del({ url: `/channels/${dmChannelId}/messages/${res.msgId}` });
        } catch {}
    } catch (e) {
        logStatus(`Sync error: ${e}`, true);
        if (manual) showToast(`${PLUGIN_TAG} Sync failed`, 2);
    }
}

// --- EMOJI STORE MODAL ---
function EmojiStoreModal() {
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
        const parts = e.name.split("_");
        const packName = parts.length > 1 ? parts[0] : "Other";
        return packName.toLowerCase() === selectedPack.toLowerCase();
    });

    return (
        <RN.View
            style={{
                maxHeight: 340,
                minHeight: 280,
                backgroundColor: "#1e1f22",
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
                paddingHorizontal: 12,
                paddingTop: 10,
                paddingBottom: 16,
            }}
        >
            {/* Header */}
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
                        <RN.Text style={{ color: "#5865F2", fontSize: 11, fontWeight: "600" }}>
                            Resync
                        </RN.Text>
                    </RN.TouchableOpacity>

                    <RN.TouchableOpacity
                        onPress={closeEmojiModal}
                        style={{
                            backgroundColor: "rgba(255, 255, 255, 0.1)",
                            borderRadius: 12,
                            width: 24,
                            height: 24,
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <RN.Text style={{ color: "#fff", fontSize: 12, fontWeight: "bold" }}>✕</RN.Text>
                    </RN.TouchableOpacity>
                </RN.View>
            </RN.View>

            {/* Tabs */}
            <RN.View style={{ flexDirection: "row", paddingVertical: 6, gap: 6 }}>
                <RN.TouchableOpacity
                    onPress={() => setTab("emojis")}
                    style={{
                        paddingVertical: 4,
                        paddingHorizontal: 12,
                        backgroundColor: tab === "emojis" ? "#5865F2" : "rgba(255,255,255,0.06)",
                        borderRadius: 6,
                    }}
                >
                    <RN.Text style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>Emojis</RN.Text>
                </RN.TouchableOpacity>
                <RN.TouchableOpacity
                    onPress={() => setTab("market")}
                    style={{
                        paddingVertical: 4,
                        paddingHorizontal: 12,
                        backgroundColor: tab === "market" ? "#5865F2" : "rgba(255,255,255,0.06)",
                        borderRadius: 6,
                    }}
                >
                    <RN.Text style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>Packs</RN.Text>
                </RN.TouchableOpacity>
            </RN.View>

            {/* Body */}
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
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderRadius: 6,
                            fontSize: 12,
                            marginBottom: 6,
                        }}
                    />

                    {packs.length > 2 && (
                        <RN.ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            style={{ maxHeight: 26, marginBottom: 6 }}
                        >
                            {packs.map((p) => (
                                <RN.TouchableOpacity
                                    key={p}
                                    onPress={() => setSelectedPack(p)}
                                    style={{
                                        paddingHorizontal: 8,
                                        paddingVertical: 2,
                                        backgroundColor: selectedPack === p ? "#5865F2" : "rgba(255,255,255,0.08)",
                                        borderRadius: 10,
                                        marginRight: 4,
                                    }}
                                >
                                    <RN.Text style={{ color: "#fff", fontSize: 10 }}>{p}</RN.Text>
                                </RN.TouchableOpacity>
                            ))}
                        </RN.ScrollView>
                    )}

                    <RN.ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="always">
                        <RN.View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingBottom: 10 }}>
                            {filteredEmojis.map((emoji) => {
                                const ext = emoji.animated ? "gif" : "png";
                                const url = `https://cdn.discordapp.com/emojis/${emoji.id}.${ext}?size=64`;
                                return (
                                    <RN.TouchableOpacity
                                        key={emoji.id}
                                        onPress={() => insertEmojiIntoDraft(emoji)}
                                        style={{
                                            alignItems: "center",
                                            justifyContent: "center",
                                            backgroundColor: "rgba(255,255,255,0.05)",
                                            borderRadius: 6,
                                            width: 40,
                                            height: 40,
                                        }}
                                    >
                                        <RN.Image
                                            source={{ uri: url }}
                                            style={{ width: 28, height: 28 }}
                                            resizeMode="contain"
                                        />
                                    </RN.TouchableOpacity>
                                );
                            })}
                        </RN.View>
                    </RN.ScrollView>
                </RN.View>
            ) : (
                <RN.ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="always">
                    {loadingPacks && (
                        <RN.Text style={{ color: "#aaa", textAlign: "center", marginTop: 10 }}>
                            Loading packs...
                        </RN.Text>
                    )}
                    {remotePacks.map((pack) => {
                        const isInstalled = pack.emojis && Object.keys(pack.emojis).some((name) =>
                            emojis.some((e) => e.name.toLowerCase() === name.toLowerCase())
                        );

                        return (
                            <FormRow
                                key={pack.name}
                                label={pack.name.toUpperCase()}
                                subLabel={pack.description || `${Object.keys(pack.emojis || {}).length} emojis`}
                                trailing={() => (
                                    <RN.TouchableOpacity
                                        onPress={async () => {
                                            const channelId = SelectedChannelStore?.getChannelId();
                                            if (!channelId) return;
                                            if (isInstalled) {
                                                await dispatchAppCommand("uninstallpack", channelId, [
                                                    { type: 3, name: "pack_name", value: pack.name },
                                                ]);
                                            } else {
                                                await dispatchAppCommand("installpack", channelId, [
                                                    { type: 3, name: "pack_name", value: pack.name },
                                                ]);
                                            }
                                            syncEmojisFromBot(false);
                                        }}
                                        style={{
                                            backgroundColor: isInstalled ? "#ED4245" : "#5865F2",
                                            paddingVertical: 4,
                                            paddingHorizontal: 8,
                                            borderRadius: 6,
                                        }}
                                    >
                                        <RN.Text style={{ color: "#fff", fontSize: 10, fontWeight: "bold" }}>
                                            {isInstalled ? "Uninstall" : "Install"}
                                        </RN.Text>
                                    </RN.TouchableOpacity>
                                )}
                            />
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
                <FormRow
                    label="Open Emoji Store Picker"
                    subLabel="Browse custom emojis"
                    onPress={openEmojiModal}
                />
                <FormRow
                    label="Force Resync Emojis"
                    subLabel={`Cached Emojis: ${storage.emojis?.length || 0}`}
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
                    subLabel="Triggers notification when proxy bot is mentioned"
                    value={storage.botPingToUserPing ?? true}
                    onValueChange={(val: boolean) => {
                        storage.botPingToUserPing = val;
                    }}
                />
            </FormSection>

            <FormSection title="Diagnostic Logs">
                {(storage.debugLogs || []).map((entry: string, idx: number) => (
                    <RN.Text key={idx} style={{ color: "#aaa", fontSize: 11, marginVertical: 2 }}>
                        {entry}
                    </RN.Text>
                ))}
            </FormSection>
        </RN.ScrollView>
    );
}

// --- CHATBAR BUTTON INJECTOR ---
function injectEmojiButton(tree: any) {
    if (!tree || !tree.props) return;

    const emojiBtn = (
        <RN.TouchableOpacity
            key="user-app-emoji-btn"
            onPress={openEmojiModal}
            style={{
                justifyContent: "center",
                alignItems: "center",
                paddingHorizontal: 6,
                paddingVertical: 4,
            }}
        >
            <RN.Text style={{ fontSize: 18 }}>💎</RN.Text>
        </RN.TouchableOpacity>
    );

    const hasButton = (list: any[]) =>
        list.some((item) => item?.key === "user-app-emoji-btn");

    if (Array.isArray(tree.props.children)) {
        if (!hasButton(tree.props.children)) {
            tree.props.children.unshift(emojiBtn);
        }
    } else if (tree.props.children?.props?.children && Array.isArray(tree.props.children.props.children)) {
        if (!hasButton(tree.props.children.props.children)) {
            tree.props.children.props.children.unshift(emojiBtn);
        }
    }
}

function patchChatBar() {
    const modulesToPatch = [
        findByName("ChatInputActions", false),
        findByName("ChatAccessories", false),
        findByName("ChatInput", false),
        findByProps("ChatInputActions"),
        findByProps("ChatAccessories"),
        findByProps("ChatInput"),
    ].filter(Boolean);

    for (const mod of modulesToPatch) {
        try {
            const funcKey = typeof mod === "function" ? null : mod.default ? "default" : Object.keys(mod).find((k) => typeof mod[k] === "function");
            
            if (funcKey) {
                unpatches.push(
                    patcher.after(funcKey, mod, (_, res) => {
                        try {
                            injectEmojiButton(res);
                        } catch {}
                        return res;
                    })
                );
            } else if (typeof mod === "function") {
                unpatches.push(
                    patcher.after(mod, (_, res) => {
                        try {
                            injectEmojiButton(res);
                        } catch {}
                        return res;
                    })
                );
            }
        } catch {}
    }
}

// --- MAIN PLUGIN LIFECYCLE ---
export default {
    settings: Settings,
    onLoad() {
        if (!storage.emojis) storage.emojis = [];
        if (!storage.apps) storage.apps = [];
        if (!storage.debugLogs) storage.debugLogs = [];
        if (storage.botPingToUserPing === undefined) storage.botPingToUserPing = true;

        logStatus("Loaded UserEmojiPicker");

        // 1. GuildStore Mock (Categories & Guild Object)
        if (GuildStore?.getGuild) {
            unpatches.push(
                patcher.instead("getGuild", GuildStore, (args, orig) => {
                    if (args[0] === "UserAppEmojis") {
                        return {
                            id: "UserAppEmojis",
                            name: USER_PICKER_CATEGORY,
                            getIconURL: () => null,
                        };
                    }
                    return orig.apply(GuildStore, args);
                })
            );
        }

        // 2. Native Autocomplete Patches (EmojiStore Integration)
        if (EmojiStore) {
            // A. Search Autocomplete List
            if (typeof EmojiStore.searchWithoutFetchingLatest === "function") {
                unpatches.push(
                    patcher.instead("searchWithoutFetchingLatest", EmojiStore, (args, orig) => {
                        const [opts] = args;
                        const result = orig.apply(EmojiStore, args) || {};
                        const query = String(opts?.query ?? "").toLowerCase();
                        const loaded: AppEmoji[] = storage.emojis || [];

                        if (!query || !loaded.length) return result;

                        if (!Array.isArray(result.unlocked)) result.unlocked = [];

                        const existingIds = new Set(result.unlocked.map((e: any) => String(e?.id ?? "")));
                        const customMatches: any[] = [];

                        for (const emoji of loaded) {
                            if (emoji.name.toLowerCase().includes(query) && !existingIds.has(emoji.id)) {
                                customMatches.push(buildEmojiObj(emoji));
                            }
                        }

                        if (customMatches.length) {
                            result.unlocked = [...customMatches, ...result.unlocked];
                        }
                        return result;
                    })
                );
            }

            // B. Custom Emoji Metadata Resolver
            if (typeof EmojiStore.getCustomEmojiById === "function") {
                unpatches.push(
                    patcher.instead("getCustomEmojiById", EmojiStore, (args, orig) => {
                        const [id] = args;
                        const loaded: AppEmoji[] = storage.emojis || [];
                        const found = loaded.find((e) => e.id === id);
                        if (found) return buildEmojiObj(found);
                        return orig.apply(EmojiStore, args);
                    })
                );
            }

            // C. Emoji Usability Flag (Prevents Nitro Lockout)
            if (typeof EmojiStore.isEmojiUsable === "function") {
                unpatches.push(
                    patcher.instead("isEmojiUsable", EmojiStore, (args, orig) => {
                        const [emoji] = args;
                        const loaded: AppEmoji[] = storage.emojis || [];
                        if (emoji && loaded.some((e) => e.id === emoji.id)) {
                            return true;
                        }
                        return orig.apply(EmojiStore, args);
                    })
                );
            }

            // D. Append to getEmojis Pool
            if (typeof EmojiStore.getEmojis === "function") {
                unpatches.push(
                    patcher.after("getEmojis", EmojiStore, (_, res) => {
                        const loaded: AppEmoji[] = storage.emojis || [];
                        if (Array.isArray(res) && loaded.length > 0) {
                            for (const emoji of loaded) {
                                res.push(buildEmojiObj(emoji));
                            }
                        }
                        return res;
                    })
                );
            }
        }

        // 3. Slash Command
        try {
            unpatches.push(
                registerCommand({
                    name: "emojistore",
                    displayName: "emojistore",
                    description: "Open User App Emoji picker",
                    displayDescription: "Open User App Emoji picker",
                    options: [],
                    execute: openEmojiModal,
                })
            );
        } catch {}

        // 4. Chat Bar Accessory Button
        patchChatBar();

        // 5. Message Interception (Sending & Bot Proxying)
        if (MessageActions) {
            unpatches.push(
                patcher.instead("sendMessage", MessageActions, async (args, orig) => {
                    const [channelId, message] = args;
                    const loaded: AppEmoji[] = storage.emojis || [];

                    if (message?.content && loaded.length > 0) {
                        let replaced = false;
                        const emojiMap = new Map(loaded.map((e) => [e.name.toLowerCase(), e]));

                        const transformed = String(message.content).replace(
                            emojiRegex,
                            (match, tag) => {
                                const found = emojiMap.get(tag.toLowerCase());
                                if (found) {
                                    replaced = true;
                                    return `;${found.name};`;
                                }
                                return match;
                            }
                        );

                        if (replaced) {
                            const app = getActiveApp();
                            if (app?.commands.e) {
                                const guildId = SelectedGuildStore?.getGuildId() || undefined;
                                await RestAPI.post({
                                    url: "/interactions",
                                    body: {
                                        type: 2,
                                        application_id: app.appId,
                                        guild_id: guildId,
                                        channel_id: channelId,
                                        session_id: AuthenticationStore.getSessionId(),
                                        data: {
                                            id: app.commands.e.id,
                                            version: app.commands.e.version,
                                            name: "e",
                                            type: 1,
                                            options: [{ type: 3, name: "text", value: transformed }],
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

        // 6. Local Message Rendering (Transform ;emoji; in incoming chat view)
        if (RowManager?.createRowFromMessage) {
            unpatches.push(
                patcher.after("createRowFromMessage", RowManager, (_, res) => {
                    const loaded: AppEmoji[] = storage.emojis || [];
                    if (res?.message?.content && loaded.length > 0) {
                        const emojiMap = new Map(loaded.map((e) => [e.name.toLowerCase(), e]));
                        res.message.content = res.message.content.replace(
                            /;([A-Za-z0-9_]+);/g,
                            (match: string, name: string) => {
                                const found = emojiMap.get(name.toLowerCase());
                                if (found) {
                                    return `<${found.animated ? "a" : ""}:${found.name}:${found.id}>`;
                                }
                                return match;
                            }
                        );
                    }
                    return res;
                })
            );
        }

        // 7. Bot Mention Interceptor
        unpatches.push(
            patcher.instead("dispatch", FluxDispatcher, (args, orig) => {
                const [event] = args;
                if (
                    event &&
                    (event.type === "MESSAGE_CREATE" || event.type === "MESSAGE_UPDATE") &&
                    storage.botPingToUserPing
                ) {
                    try {
                        const msg = event.message;
                        const botId = storage.selectedAppId;
                        const currentUser = UserStore?.getCurrentUser?.();

                        if (msg && botId && currentUser) {
                            let isPinged = false;
                            if (msg.referenced_message?.author?.id === botId) isPinged = true;
                            if (!isPinged && Array.isArray(msg.mentions) && msg.mentions.some((m: any) => m.id === botId)) {
                                isPinged = true;
                            }

                            if (isPinged) {
                                if (!Array.isArray(msg.mentions)) msg.mentions = [];
                                if (!msg.mentions.some((m: any) => m.id === currentUser.id)) {
                                    msg.mentions.push(currentUser);
                                }
                            }
                        }
                    } catch {}
                }
                return orig.apply(FluxDispatcher, args);
            })
        );

        // 8. ActionSheet Long-Press Hook (Steal Emojis)
        if (LazyActionSheet?.openLazy) {
            unpatches.push(
                patcher.before("openLazy", LazyActionSheet, (args) => {
                    const [factory, key] = args;
                    if (key === "MessageLongPressActionSheet" || key === "MessageActionsActionSheet") {
                        args[0] = async () => {
                            const Component = await factory();
                            return (props: any) => {
                                const rendered = typeof Component === "function" ? Component(props) : Component;
                                if (!rendered) return rendered;

                                try {
                                    const message = props?.message;
                                    const content = message?.content || "";
                                    const app = getActiveApp();

                                    if (app) {
                                        const matches = Array.from(content.matchAll(emojiRegex));
                                        if (matches.length > 0) {
                                            const stealButtons = matches.map((m) => {
                                                const raw = m[0];
                                                const name = m[1];
                                                return (
                                                    <RN.TouchableOpacity
                                                        key={`steal-${name}-${m[2]}`}
                                                        onPress={() => {
                                                            closeEmojiModal();
                                                            dispatchAppCommand("stealemoji", message.channel_id, [
                                                                { type: 3, name: "emoji", value: raw },
                                                                { type: 3, name: "new_name", value: name },
                                                            ]);
                                                        }}
                                                        style={{
                                                            padding: 12,
                                                            backgroundColor: "rgba(255,255,255,0.06)",
                                                            borderRadius: 8,
                                                            marginVertical: 4,
                                                        }}
                                                    >
                                                        <RN.Text style={{ color: "#5865F2", fontWeight: "bold" }}>
                                                            📥 Steal :{name}:
                                                        </RN.Text>
                                                    </RN.TouchableOpacity>
                                                );
                                            });

                                            if (rendered?.props && Array.isArray(rendered.props.children)) {
                                                rendered.props.children.push(...stealButtons);
                                            } else if (rendered?.props?.children?.props && Array.isArray(rendered.props.children.props.children)) {
                                                rendered.props.children.props.children.push(...stealButtons);
                                            }
                                        }
                                    }
                                } catch {}
                                return rendered;
                            };
                        };
                    }
                    return args;
                })
            );
        }

        syncEmojisFromBot(false);
    },

    onUnload() {
        for (const unpatch of unpatches) {
            try {
                if (typeof unpatch === "function") unpatch();
            } catch {}
        }
        unpatches = [];
        logStatus("Unloaded all patches.");
    },
};
