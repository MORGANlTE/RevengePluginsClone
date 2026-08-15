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
const AlertActions = findByProps("dismissAlert", "openAlert");
const RowManager = findByProps("createRowFromMessage", "generateRows");
const DraftStore = findByStoreName("DraftStore");
const DraftActions = findByProps("saveDraft", "setDraft", "updateDraft");
const ComponentDispatch = findByProps("dispatchToLastSubscribed") || findByProps("dispatch");
const TextUtils = findByProps("insertText");

const { FormSection, FormSwitchRow, FormInput, FormRow } = Forms;
let unpatches: Function[] = [];

// --- HELPER PARSERS & URL GENERATORS ---
function getEmojiCdnUrl(id: string, animated = false) {
    const ext = animated ? "gif" : "webp";
    return `https://cdn.discordapp.com/emojis/${id}.${ext}?size=64&quality=lossless`;
}

function parseRawEmojiTag(rawTag: string) {
    if (!rawTag) return null;
    if (rawTag.startsWith("<") && rawTag.endsWith(">")) {
        const clean = rawTag.replace(/[<>]/g, "");
        const parts = clean.split(":");
        const isAnimated = parts[0] === "a";
        const name = parts.length > 2 ? parts[1] : parts[0];
        const id = parts[parts.length - 1];
        return {
            id,
            name,
            animated: isAnimated,
            url: getEmojiCdnUrl(id, isAnimated),
        };
    }
    if (rawTag.startsWith("http")) {
        return { id: "", name: "", animated: false, url: rawTag };
    }
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
        url: getEmojiCdnUrl(emoji.id, Boolean(emoji.animated)),
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

    if (isError) {
        console.error(`${PLUGIN_TAG} 🔴 ${msg}`);
    } else {
        console.log(`${PLUGIN_TAG} 🟢 ${msg}`);
    }
}

export function getActiveApp(): DiscoveredApp | undefined {
    return (storage.apps || []).find((a: DiscoveredApp) => a.appId === storage.selectedAppId);
}

export function closeEmojiModal() {
    try {
        if (LazyActionSheet?.hideActionSheet) LazyActionSheet.hideActionSheet();
        const sheetMod = findByProps("hideActionSheet");
        if (sheetMod?.hideActionSheet) sheetMod.hideActionSheet();
        if (ModalActions?.popModal) ModalActions.popModal("CustomEmojiStoreSheet");
        if (AlertActions?.dismissAlert) AlertActions.dismissAlert();
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

export function insertEmojiIntoDraft(emoji: AppEmoji) {
    const channelId = SelectedChannelStore?.getChannelId();
    const tag = `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}> `;
    let inserted = false;

    try {
        if (ComponentDispatch?.dispatchToLastSubscribed) {
            ComponentDispatch.dispatchToLastSubscribed("INSERT_TEXT", {
                plainText: tag,
                rawText: tag,
            });
            inserted = true;
        } else if (ComponentDispatch?.dispatch) {
            ComponentDispatch.dispatch("INSERT_TEXT", {
                plainText: tag,
                rawText: tag,
            });
            inserted = true;
        }
    } catch {}

    if (!inserted && channelId) {
        try {
            if (DraftActions && DraftStore) {
                const currentDraft = DraftStore.getDraft(channelId, 0) || "";
                const updated = (currentDraft ? currentDraft.trimEnd() + " " : "") + tag;

                if (typeof DraftActions.saveDraft === "function") {
                    DraftActions.saveDraft(channelId, updated, 0);
                    inserted = true;
                } else if (typeof DraftActions.setDraft === "function") {
                    DraftActions.setDraft(channelId, updated, 0);
                    inserted = true;
                } else if (typeof DraftActions.updateDraft === "function") {
                    DraftActions.updateDraft(channelId, updated, 0);
                    inserted = true;
                }
            }
        } catch {}
    }

    if (!inserted) {
        try {
            if (TextUtils?.insertText) {
                TextUtils.insertText(tag);
                inserted = true;
            }
        } catch {}
    }

    if (!inserted) {
        RN.Clipboard.setString(tag);
        showToast(`${PLUGIN_TAG} Copied :${emoji.name}: to clipboard`, 1);
    }

    closeEmojiModal();
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

// --- EMOJI STORE MODAL (WITH PREVIEWS & ICONS) ---
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
                height: 340,
                maxHeight: 340,
                backgroundColor: "#1e1f22",
                borderTopLeftRadius: 18,
                borderTopRightRadius: 18,
                paddingHorizontal: 12,
                paddingTop: 10,
                paddingBottom: 12,
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
                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                        style={{
                            backgroundColor: "rgba(255, 255, 255, 0.15)",
                            borderRadius: 14,
                            width: 26,
                            height: 26,
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <RN.Text style={{ color: "#fff", fontSize: 13, fontWeight: "bold" }}>✕</RN.Text>
                    </RN.TouchableOpacity>
                </RN.View>
            </RN.View>

            {/* Navigation Tabs */}
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

            {/* Content Body */}
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
                                const url = getEmojiCdnUrl(emoji.id, Boolean(emoji.animated));
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
                            Loading remote packs...
                        </RN.Text>
                    )}
                    {remotePacks.map((pack) => {
                        const isInstalled = pack.emojis && Object.keys(pack.emojis).some((name) =>
                            emojis.some((e) => e.name.toLowerCase() === name.toLowerCase())
                        );

                        const iconData = parseRawEmojiTag(pack.iconUrl || "");
                        const emojiEntries = Object.entries(pack.emojis || {});
                        const previewEmojis = emojiEntries.slice(0, 10);
                        const overflowCount = emojiEntries.length - 10;

                        return (
                            <RN.View
                                key={pack.name}
                                style={{
                                    backgroundColor: "rgba(255,255,255,0.05)",
                                    borderRadius: 10,
                                    padding: 10,
                                    marginBottom: 10,
                                    borderWidth: 1,
                                    borderColor: "rgba(255,255,255,0.08)",
                                }}
                            >
                                <RN.View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                                    <RN.View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                                        {iconData ? (
                                            <RN.Image
                                                source={{ uri: iconData.url }}
                                                style={{ width: 34, height: 34, borderRadius: 6 }}
                                                resizeMode="contain"
                                            />
                                        ) : (
                                            <RN.Text style={{ fontSize: 24 }}>📦</RN.Text>
                                        )}
                                        <RN.View style={{ flex: 1 }}>
                                            <RN.Text style={{ color: "#fff", fontSize: 13, fontWeight: "bold" }}>
                                                {pack.name.toUpperCase()}
                                            </RN.Text>
                                            <RN.Text style={{ color: "#aaa", fontSize: 11 }} numberOfLines={1}>
                                                {pack.description || `${emojiEntries.length} custom emojis`}
                                            </RN.Text>
                                        </RN.View>
                                    </RN.View>

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
                                            paddingVertical: 5,
                                            paddingHorizontal: 10,
                                            borderRadius: 6,
                                        }}
                                    >
                                        <RN.Text style={{ color: "#fff", fontSize: 11, fontWeight: "bold" }}>
                                            {isInstalled ? "Uninstall" : "Install"}
                                        </RN.Text>
                                    </RN.TouchableOpacity>
                                </RN.View>

                                <RN.View
                                    style={{
                                        flexDirection: "row",
                                        alignItems: "center",
                                        gap: 4,
                                        backgroundColor: "rgba(0,0,0,0.25)",
                                        padding: 6,
                                        borderRadius: 6,
                                    }}
                                >
                                    {previewEmojis.map(([name, tag]) => {
                                        const parsed = parseRawEmojiTag(tag);
                                        if (!parsed) return null;
                                        return (
                                            <RN.Image
                                                key={name}
                                                source={{ uri: parsed.url }}
                                                style={{ width: 22, height: 22 }}
                                                resizeMode="contain"
                                            />
                                        );
                                    })}
                                    {overflowCount > 0 && (
                                        <RN.Text style={{ color: "#aaa", fontSize: 10, fontWeight: "bold", marginLeft: 4 }}>
                                            +{overflowCount}
                                        </RN.Text>
                                    )}
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

// --- FLOATING ACTION BUTTON (FAB) ---
function renderFloatingButton() {
    return (
        <RN.TouchableOpacity
            key="morganite-fab-button"
            onPress={openEmojiModal}
            activeOpacity={0.8}
            style={{
                position: "absolute",
                right: 14,
                bottom: 64,
                width: 38,
                height: 38,
                borderRadius: 19,
                backgroundColor: "#5865F2",
                alignItems: "center",
                justifyContent: "center",
                elevation: 10,
                zIndex: 9999,
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.35,
                shadowRadius: 4,
            }}
        >
            <RN.Text style={{ fontSize: 18 }}>💎</RN.Text>
        </RN.TouchableOpacity>
    );
}

function patchChatView() {
    const chatModules = [
        findByName("MessagesWrapper", false),
        findByName("Chat", false),
        findByName("Channel", false),
        findByProps("MessagesWrapper"),
    ].filter(Boolean);

    for (const mod of chatModules) {
        try {
            const key = typeof mod === "function" ? null : mod.default ? "default" : Object.keys(mod).find((k) => typeof mod[k] === "function");
            const target = key ? mod : mod;
            const targetProp = key || target;

            if (typeof target[targetProp] === "function") {
                unpatches.push(
                    patcher.after(targetProp, target, (_, res) => {
                        if (!res || !res.props) return res;
                        const children = res.props.children;

                        const hasFAB = (list: any[]) =>
                            Array.isArray(list) && list.some((item) => item?.key === "morganite-fab-button");

                        if (Array.isArray(children) && !hasFAB(children)) {
                            children.push(renderFloatingButton());
                        } else if (res.props && !Array.isArray(children)) {
                            res.props.children = [children, renderFloatingButton()];
                        }
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

        // 1. GuildStore Mock[cite: 3]
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

        // 2. EmojiStore Autocomplete[cite: 3]
        if (EmojiStore) {
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
        }

        // 3. DraftActions Interceptor (Live Chatbar Emoji Preview Replacement)
        if (DraftActions) {
            const transformDraftText = (text: string) => {
                if (typeof text !== "string" || !storage.emojis?.length) return text;
                const emojiMap = new Map(storage.emojis.map((e: AppEmoji) => [e.name.toLowerCase(), e]));

                return text.replace(
                    /(?<!<a?:[A-Za-z0-9_]+:\d+)(?::([A-Za-z0-9_]+):|;([A-Za-z0-9_]+);)/g,
                    (match, colon, semi) => {
                        const raw = (colon || semi || "").toLowerCase();
                        const found = emojiMap.get(raw);
                        if (found) {
                            return `<${found.animated ? "a" : ""}:${found.name}:${found.id}>`;
                        }
                        return match;
                    }
                );
            };

            if (typeof DraftActions.saveDraft === "function") {
                unpatches.push(
                    patcher.instead("saveDraft", DraftActions, (args, orig) => {
                        if (typeof args[1] === "string") {
                            args[1] = transformDraftText(args[1]);
                        }
                        return orig.apply(DraftActions, args);
                    })
                );
            }

            if (typeof DraftActions.setDraft === "function") {
                unpatches.push(
                    patcher.instead("setDraft", DraftActions, (args, orig) => {
                        if (typeof args[1] === "string") {
                            args[1] = transformDraftText(args[1]);
                        }
                        return orig.apply(DraftActions, args);
                    })
                );
            }
        }

        // 4. Slash Command
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

        // 5. Mount Floating Button
        patchChatView();

        // 6. Message Interception (Sending & Proxying)[cite: 3]
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

        // 7. Local Message View Parser[cite: 3]
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

        // 8. Bot Ping Interceptor[cite: 3]
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

        // 9. Crash-Proof ActionSheet Long-Press Hook
        if (LazyActionSheet?.openLazy) {
            unpatches.push(
                patcher.before("openLazy", LazyActionSheet, (args) => {
                    const [factory, key] = args;
                    if (key === "MessageLongPressActionSheet" || key === "MessageActionsActionSheet") {
                        args[0] = async () => {
                            try {
                                const Component = await factory();
                                return function PatchedActionSheet(props: any) {
                                    const baseElement = React.createElement(
                                        Component?.default || Component,
                                        props
                                    );

                                    try {
                                        const message = props?.message;
                                        const content = message?.content || "";
                                        const app = getActiveApp();

                                        if (!app || !content) return baseElement;

                                        const matches = Array.from(content.matchAll(emojiRegex));
                                        if (matches.length === 0) return baseElement;

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
                                                        padding: 14,
                                                        flexDirection: "row",
                                                        alignItems: "center",
                                                        justifyContent: "space-between",
                                                        backgroundColor: "rgba(255, 255, 255, 0.08)",
                                                        borderRadius: 10,
                                                        marginHorizontal: 12,
                                                        marginVertical: 4,
                                                    }}
                                                >
                                                    <RN.Text style={{ color: "#fff", fontSize: 14, fontWeight: "bold" }}>
                                                        Steal :{name}:
                                                    </RN.Text>
                                                    <RN.Text style={{ fontSize: 16 }}>📥</RN.Text>
                                                </RN.TouchableOpacity>
                                            );
                                        });

                                        const existingChildren = Array.isArray(baseElement.props?.children)
                                            ? baseElement.props.children
                                            : baseElement.props?.children
                                            ? [baseElement.props.children]
                                            : [];

                                        return React.cloneElement(
                                            baseElement,
                                            baseElement.props,
                                            ...existingChildren,
                                            ...stealButtons
                                        );
                                    } catch (renderErr) {
                                        logStatus(`ActionSheet injection failed gracefully: ${renderErr}`, true);
                                        return baseElement;
                                    }
                                };
                            } catch (loadErr) {
                                logStatus(`ActionSheet factory failed: ${loadErr}`, true);
                                return factory();
                            }
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
