import { ActionSheet } from "$/components/ActionSheet";
import { React, ReactNative as RN } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
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
} from "../utils/botApi";
import { insertEmojiIntoDraft } from "../utils/draft";

export default function EmojiStoreModal() {
    const [tab, setTab] = React.useState<"emojis" | "market">("emojis");
    const [search, setSearch] = React.useState("");
    const [selectedPack, setSelectedPack] = React.useState("All");
    const [remotePacks, setRemotePacks] = React.useState<EmojiPack[]>(getRemotePacksCached());
    const [loadingPacks, setLoadingPacks] = React.useState(false);

    const emojis: AppEmoji[] = storage.emojis || [];
    const SHEET_HEIGHT = 330;

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
        const q = search.toLowerCase();
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
                        flex: 1 / 6,
                        aspectRatio: 1,
                        margin: 3,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: "rgba(255, 255, 255, 0.06)",
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
        <ActionSheet title="Custom Emojis">
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
                {/* Header bar: count & resync */}
                <RN.View
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        paddingBottom: 6,
                        borderBottomWidth: 1,
                        borderBottomColor: "rgba(255, 255, 255, 0.08)",
                    }}
                >
                    <RN.Text style={{ color: "#aaa", fontSize: 11 }}>
                        {emojis.length} emojis cached
                    </RN.Text>

                    <RN.TouchableOpacity
                        onPress={() => syncEmojisFromBot(true)}
                        style={{
                            paddingVertical: 3,
                            paddingHorizontal: 8,
                            backgroundColor: "rgba(88, 101, 242, 0.2)",
                            borderRadius: 6,
                        }}
                    >
                        <RN.Text style={{ color: "#5865F2", fontSize: 10, fontWeight: "bold" }}>
                            🔄 Resync
                        </RN.Text>
                    </RN.TouchableOpacity>
                </RN.View>

                {/* Tab Switcher */}
                <RN.View style={{ flexDirection: "row", paddingVertical: 6, gap: 6 }}>
                    <RN.TouchableOpacity
                        onPress={() => setTab("emojis")}
                        style={{
                            flex: 1,
                            paddingVertical: 5,
                            alignItems: "center",
                            backgroundColor: tab === "emojis" ? "#5865F2" : "rgba(255, 255, 255, 0.06)",
                            borderRadius: 6,
                        }}
                    >
                        <RN.Text style={{ color: "#fff", fontSize: 11, fontWeight: "bold" }}>
                            Local Emojis
                        </RN.Text>
                    </RN.TouchableOpacity>
                    <RN.TouchableOpacity
                        onPress={() => setTab("market")}
                        style={{
                            flex: 1,
                            paddingVertical: 5,
                            alignItems: "center",
                            backgroundColor: tab === "market" ? "#5865F2" : "rgba(255, 255, 255, 0.06)",
                            borderRadius: 6,
                        }}
                    >
                        <RN.Text style={{ color: "#fff", fontSize: 11, fontWeight: "bold" }}>
                            Packs Market
                        </RN.Text>
                    </RN.TouchableOpacity>
                </RN.View>

                {/* Tab 1: Local Emojis */}
                {tab === "emojis" ? (
                    <RN.View style={{ flex: 1 }}>
                        <RN.TextInput
                            value={search}
                            placeholder="Search emojis..."
                            placeholderTextColor="#888"
                            onChangeText={setSearch}
                            style={{
                                backgroundColor: "rgba(0, 0, 0, 0.3)",
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
                                nestedScrollEnabled={true}
                                style={{ maxHeight: 26, marginBottom: 6 }}
                                contentContainerStyle={{ alignItems: "center" }}
                            >
                                {packs.map((p) => (
                                    <RN.TouchableOpacity
                                        key={p}
                                        onPress={() => setSelectedPack(p)}
                                        style={{
                                            paddingHorizontal: 8,
                                            paddingVertical: 3,
                                            backgroundColor:
                                                selectedPack === p ? "#5865F2" : "rgba(255, 255, 255, 0.08)",
                                            borderRadius: 8,
                                            marginRight: 4,
                                        }}
                                    >
                                        <RN.Text style={{ color: "#fff", fontSize: 10 }}>{p}</RN.Text>
                                    </RN.TouchableOpacity>
                                ))}
                            </RN.ScrollView>
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
                            <RN.FlatList
                                data={filteredEmojis}
                                keyExtractor={(item) => item.id}
                                renderItem={renderEmojiItem}
                                numColumns={6}
                                initialNumToRender={36}
                                maxToRenderPerBatch={24}
                                windowSize={5}
                                removeClippedSubviews={true}
                                nestedScrollEnabled={true}
                                keyboardShouldPersistTaps="always"
                                style={{ flex: 1 }}
                                contentContainerStyle={{ paddingBottom: 8 }}
                            />
                        )}
                    </RN.View>
                ) : (
                    /* Tab 2: Packs Market */
                    <RN.View style={{ flex: 1 }}>
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
                        <RN.FlatList
                            data={remotePacks}
                            keyExtractor={(item) => item.name}
                            renderItem={renderPackItem}
                            initialNumToRender={8}
                            maxToRenderPerBatch={6}
                            nestedScrollEnabled={true}
                            keyboardShouldPersistTaps="always"
                            style={{ flex: 1 }}
                            contentContainerStyle={{ paddingBottom: 8 }}
                        />
                    </RN.View>
                )}
            </RN.View>
        </ActionSheet>
    );
}
