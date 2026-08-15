import { findByProps } from "@vendetta/metro";
import { React, ReactNative as RN } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { showToast } from "@vendetta/ui/toasts";
import { without } from "@vendetta/utils";
import { AppEmoji, EmojiPack } from "../types";
import {
    dispatchAppCommand,
    getEmojiCdnUrl,
    getRemotePacksCached,
    PACKS_URL,
    parseRawEmojiTag,
    preloadRemotePacks,
    SelectedChannelStore,
    syncEmojisFromBot,
} from "./botApi";
import { insertEmojiIntoDraft } from "./draft";
import { logStatus, PLUGIN_TAG } from "./logger";

const { ActionSheet: _ActionSheet } = findByProps("ActionSheet");
const { BottomSheetTitleHeader } = findByProps("BottomSheetTitleHeader");
const { ActionSheetCloseButton } = findByProps("ActionSheetCloseButton");
export const LazyActionSheet = findByProps("openLazy", "hideActionSheet");
export const { openLazy, hideActionSheet } = LazyActionSheet;
export const { showSimpleActionSheet } = findByProps("showSimpleActionSheet");

const BottomSheetComponents =
    findByProps("BottomSheetFlatList", "BottomSheetScrollView") ||
    findByProps("BottomSheetScrollView");

const ListComponent = BottomSheetComponents?.BottomSheetFlatList || RN.FlatList;
const ScrollComponent = BottomSheetComponents?.BottomSheetScrollView || RN.ScrollView;

export const ActionSheet = (props: any) =>
    React.createElement(
        _ActionSheet,
        {
            header: React.createElement(BottomSheetTitleHeader, {
                title: props.title,
                trailing: React.createElement(ActionSheetCloseButton, {
                    onPress: props.onClose ?? (() => {
                        hideActionSheet();
                    }),
                }),
            }),
        },
        React.createElement(RN.View, without(props, "title", "onClose"))
    );

ActionSheet.open = (sheet: any, props: any) => {
    openLazy(
        new Promise((res) => {
            res({ default: sheet });
        }),
        "ActionSheet",
        props
    );
};

export function EmojiStoreModal() {
    const [tab, setTab] = React.useState<"emojis" | "market">("emojis");
    const [search, setSearch] = React.useState("");
    const [selectedPack, setSelectedPack] = React.useState("All");
    const [remotePacks, setRemotePacks] = React.useState<EmojiPack[]>(getRemotePacksCached());
    const [loadingPacks, setLoadingPacks] = React.useState(false);

    const emojis: AppEmoji[] = storage.emojis || [];
    const SHEET_HEIGHT = Math.min(RN.Dimensions.get("window").height * 0.6, 460);

    React.useEffect(() => {
        preloadRemotePacks();
        if (tab === "market" && remotePacks.length === 0) {
            setLoadingPacks(true);
            fetch(PACKS_URL)
                .then((res) => res.json())
                .then((data) => setRemotePacks(Array.isArray(data) ? data : []))
                .catch(() => {})
                .finally(() => setLoadingPacks(false));
        }
    }, [tab]);

    const packs = React.useMemo(() => {
        const set = new Set(
            emojis.map((e) => {
                const parts = e.name.split("_");
                return parts.length > 1 ? parts[0] : "Other";
            })
        );
        const sorted = Array.from(set).sort();
        sorted.unshift("All");
        return sorted;
    }, [emojis]);

    const filteredEmojis = React.useMemo(() => {
        const q = search.trim().toLowerCase();
        return emojis.filter((e) => {
            const matchesSearch = !q || e.name.toLowerCase().includes(q);
            if (!matchesSearch) return false;
            if (selectedPack === "All") return true;
            const parts = e.name.split("_");
            const packName = parts.length > 1 ? parts[0] : "Other";
            return packName.toLowerCase() === selectedPack.toLowerCase();
        });
    }, [emojis, search, selectedPack]);

    const renderEmojiItem = React.useCallback(
        ({ item }: { item: AppEmoji }) => {
            const url = getEmojiCdnUrl(item.id, Boolean(item.animated));
            return (
                <RN.TouchableOpacity
                    key={item.id}
                    onPress={() => insertEmojiIntoDraft(item)}
                    activeOpacity={0.6}
                    style={{
                        flex: 1 / 7,
                        aspectRatio: 1,
                        margin: 2,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: "rgba(255, 255, 255, 0.07)",
                        borderRadius: 8,
                    }}
                >
                    <RN.Image
                        source={{ uri: url }}
                        style={{ width: 30, height: 30 }}
                        resizeMode="contain"
                    />
                </RN.TouchableOpacity>
            );
        },
        []
    );

    const renderPackItem = React.useCallback(
        ({ item: pack }: { item: EmojiPack }) => {
            const isInstalled =
                pack.emojis &&
                Object.keys(pack.emojis).some((name) =>
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
                        backgroundColor: "rgba(255, 255, 255, 0.05)",
                        borderRadius: 10,
                        padding: 10,
                        marginBottom: 10,
                        borderWidth: 1,
                        borderColor: "rgba(255, 255, 255, 0.08)",
                    }}
                >
                    <RN.View
                        style={{
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                            marginBottom: 8,
                        }}
                    >
                        <RN.View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                            {iconData?.url ? (
                                <RN.Image
                                    source={{ uri: iconData.url }}
                                    style={{ width: 32, height: 32, borderRadius: 6 }}
                                    resizeMode="contain"
                                />
                            ) : (
                                <RN.Text style={{ fontSize: 22 }}>📦</RN.Text>
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
                                paddingHorizontal: 12,
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
                            backgroundColor: "rgba(0, 0, 0, 0.25)",
                            padding: 6,
                            borderRadius: 6,
                        }}
                    >
                        {previewEmojis.map(([name, tag]) => {
                            const parsed = parseRawEmojiTag(tag);
                            if (!parsed?.url) return null;
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
                            <RN.Text
                                style={{
                                    color: "#aaa",
                                    fontSize: 10,
                                    fontWeight: "bold",
                                    marginLeft: 4,
                                }}
                            >
                                +{overflowCount}
                            </RN.Text>
                        )}
                    </RN.View>
                </RN.View>
            );
        },
        [emojis]
    );

    return (
        <ActionSheet title="💎 Custom Emojis">
            <RN.View
                style={{
                    height: SHEET_HEIGHT,
                    maxHeight: SHEET_HEIGHT,
                    paddingHorizontal: 10,
                    paddingBottom: 8,
                    display: "flex",
                    flexDirection: "column",
                }}
            >
                {/* Header Action Bar */}
                <RN.View
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        paddingBottom: 8,
                        borderBottomWidth: 1,
                        borderBottomColor: "rgba(255, 255, 255, 0.08)",
                    }}
                >
                    <RN.Text style={{ color: "#aaa", fontSize: 12, fontWeight: "600" }}>
                        {emojis.length} emojis cached
                    </RN.Text>

                    <RN.View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        {/* Market Cart Button */}
                        <RN.TouchableOpacity
                            onPress={() => setTab(tab === "emojis" ? "market" : "emojis")}
                            style={{
                                paddingVertical: 5,
                                paddingHorizontal: 10,
                                backgroundColor: tab === "market" ? "#5865F2" : "rgba(255, 255, 255, 0.08)",
                                borderRadius: 8,
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 4,
                            }}
                        >
                            <RN.Text style={{ fontSize: 14 }}>🛒</RN.Text>
                            <RN.Text style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>
                                {tab === "market" ? "Local" : "Market"}
                            </RN.Text>
                        </RN.TouchableOpacity>

                        {/* Resync Button */}
                        <RN.TouchableOpacity
                            onPress={() => syncEmojisFromBot(true)}
                            style={{
                                paddingVertical: 5,
                                paddingHorizontal: 12,
                                backgroundColor: "rgba(88, 101, 242, 0.25)",
                                borderRadius: 8,
                            }}
                        >
                            <RN.Text style={{ color: "#5865F2", fontSize: 12, fontWeight: "bold" }}>
                                🔄 Resync
                            </RN.Text>
                        </RN.TouchableOpacity>
                    </RN.View>
                </RN.View>

                {/* Tab 1: Local Emojis */}
                {tab === "emojis" ? (
                    <RN.View style={{ flex: 1, paddingTop: 6 }}>
                        <RN.TextInput
                            value={search}
                            placeholder="Search emojis..."
                            placeholderTextColor="#888"
                            onChangeText={(txt: string) => setSearch(txt)}
                            style={{
                                backgroundColor: "rgba(0, 0, 0, 0.35)",
                                color: "#fff",
                                paddingHorizontal: 10,
                                paddingVertical: 6,
                                borderRadius: 8,
                                fontSize: 13,
                                marginBottom: 6,
                            }}
                        />

                        {packs.length > 2 && (
                            <ScrollComponent
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                nestedScrollEnabled={true}
                                style={{ maxHeight: 28, marginBottom: 6 }}
                                contentContainerStyle={{ alignItems: "center" }}
                            >
                                {packs.map((p) => (
                                    <RN.TouchableOpacity
                                        key={p}
                                        onPress={() => setSelectedPack(p)}
                                        style={{
                                            paddingHorizontal: 10,
                                            paddingVertical: 4,
                                            backgroundColor:
                                                selectedPack === p ? "#5865F2" : "rgba(255, 255, 255, 0.08)",
                                            borderRadius: 8,
                                            marginRight: 6,
                                        }}
                                    >
                                        <RN.Text style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>{p}</RN.Text>
                                    </RN.TouchableOpacity>
                                ))}
                            </ScrollComponent>
                        )}

                        {filteredEmojis.length === 0 ? (
                            <RN.View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
                                <RN.Text style={{ color: "#888", fontSize: 12 }}>
                                    {emojis.length === 0
                                        ? "No emojis cached. Tap Resync to fetch from bot!"
                                        : "No emojis match your search."}
                                </RN.Text>
                            </RN.View>
                        ) : (
                            <ListComponent
                                key="emoji-grid-modal-7"
                                data={filteredEmojis}
                                keyExtractor={(item: any) => item.id}
                                renderItem={renderEmojiItem}
                                numColumns={7}
                                initialNumToRender={42}
                                maxToRenderPerBatch={28}
                                windowSize={7}
                                removeClippedSubviews={false}
                                nestedScrollEnabled={true}
                                scrollEnabled={true}
                                showsVerticalScrollIndicator={true}
                                keyboardShouldPersistTaps="always"
                                style={{ flex: 1 }}
                                contentContainerStyle={{ paddingBottom: 24 }}
                            />
                        )}
                    </RN.View>
                ) : (
                    /* Tab 2: Packs Market */
                    <RN.View style={{ flex: 1, paddingTop: 6 }}>
                        {loadingPacks && (
                            <RN.Text style={{ color: "#aaa", textAlign: "center", marginVertical: 12, fontSize: 12 }}>
                                Loading remote packs...
                            </RN.Text>
                        )}
                        {!loadingPacks && remotePacks.length === 0 && (
                            <RN.Text style={{ color: "#aaa", textAlign: "center", marginVertical: 12, fontSize: 12 }}>
                                No remote packs found.
                            </RN.Text>
                        )}
                        <ListComponent
                            key="market-list-modal-1"
                            data={remotePacks}
                            keyExtractor={(item: any) => item.name}
                            renderItem={renderPackItem}
                            numColumns={1}
                            initialNumToRender={8}
                            maxToRenderPerBatch={6}
                            nestedScrollEnabled={true}
                            scrollEnabled={true}
                            showsVerticalScrollIndicator={true}
                            keyboardShouldPersistTaps="always"
                            style={{ flex: 1 }}
                            contentContainerStyle={{ paddingBottom: 24 }}
                        />
                    </RN.View>
                )}
            </RN.View>
        </ActionSheet>
    );
}

export function closeEmojiModal() {
    try {
        hideActionSheet();
    } catch (e) {
        logStatus(`Error closing emoji modal: ${String(e)}`, true);
    }
}

export function toggleEmojiStore() {
    RN.Keyboard.dismiss();
    openEmojiModal();
}

export function openEmojiStore() {
    RN.Keyboard.dismiss();
    openEmojiModal();
}

export function openEmojiModal() {
    try {
        ActionSheet.open(EmojiStoreModal, undefined);
        logStatus("Opened Custom Emoji Store modal");
    } catch (e) {
        logStatus(`openEmojiModal error: ${String(e)}`, true);
        showToast(`${PLUGIN_TAG} ActionSheet unavailable`, 2);
    }
}
