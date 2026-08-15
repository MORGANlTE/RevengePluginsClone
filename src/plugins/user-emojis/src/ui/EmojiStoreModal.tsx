import { ActionSheet, hideActionSheet } from "$/components/ActionSheet";
import { React, ReactNative as RN } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { AppEmoji, EmojiPack } from "../types";
import {
    dispatchAppCommand,
    getEmojiCdnUrl,
    PACKS_URL,
    parseRawEmojiTag,
    SelectedChannelStore,
    syncEmojisFromBot,
} from "../utils/botApi";
import { insertEmojiIntoDraft } from "../utils/draft";

export default function EmojiStoreModal() {
    const [tab, setTab] = React.useState<"emojis" | "market">("emojis");
    const [search, setSearch] = React.useState("");
    const [selectedPack, setSelectedPack] = React.useState("All");
    const [remotePacks, setRemotePacks] = React.useState<EmojiPack[]>([]);
    const [loadingPacks, setLoadingPacks] = React.useState(false);

    const emojis: AppEmoji[] = storage.emojis || [];
    const windowHeight = RN.Dimensions.get("window").height;
    const contentMaxHeight = Math.max(300, Math.min(windowHeight * 0.65, 480));

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
        <ActionSheet title="Custom Emojis">
            <RN.View
                style={{
                    maxHeight: contentMaxHeight,
                    height: contentMaxHeight,
                    paddingHorizontal: 12,
                    paddingBottom: 12,
                    display: "flex",
                    flexDirection: "column",
                }}
            >
                {/* Subheader with emoji count & resync */}
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
                    <RN.View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <RN.Text style={{ color: "#aaa", fontSize: 12 }}>
                            {emojis.length} emojis available
                        </RN.Text>
                    </RN.View>

                    <RN.TouchableOpacity
                        onPress={() => syncEmojisFromBot(true)}
                        style={{
                            paddingVertical: 4,
                            paddingHorizontal: 10,
                            backgroundColor: "rgba(88, 101, 242, 0.2)",
                            borderRadius: 6,
                        }}
                    >
                        <RN.Text style={{ color: "#5865F2", fontSize: 11, fontWeight: "bold" }}>
                            🔄 Resync
                        </RN.Text>
                    </RN.TouchableOpacity>
                </RN.View>

                {/* Tab Switcher */}
                <RN.View style={{ flexDirection: "row", paddingVertical: 8, gap: 8 }}>
                    <RN.TouchableOpacity
                        onPress={() => setTab("emojis")}
                        style={{
                            flex: 1,
                            paddingVertical: 6,
                            alignItems: "center",
                            backgroundColor: tab === "emojis" ? "#5865F2" : "rgba(255,255,255,0.06)",
                            borderRadius: 8,
                        }}
                    >
                        <RN.Text style={{ color: "#fff", fontSize: 12, fontWeight: "bold" }}>
                            Local Emojis
                        </RN.Text>
                    </RN.TouchableOpacity>
                    <RN.TouchableOpacity
                        onPress={() => setTab("market")}
                        style={{
                            flex: 1,
                            paddingVertical: 6,
                            alignItems: "center",
                            backgroundColor: tab === "market" ? "#5865F2" : "rgba(255,255,255,0.06)",
                            borderRadius: 8,
                        }}
                    >
                        <RN.Text style={{ color: "#fff", fontSize: 12, fontWeight: "bold" }}>
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
                                backgroundColor: "rgba(0,0,0,0.3)",
                                color: "#fff",
                                paddingHorizontal: 10,
                                paddingVertical: 6,
                                borderRadius: 8,
                                fontSize: 13,
                                marginBottom: 8,
                            }}
                        />

                        {packs.length > 2 && (
                            <RN.ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                style={{ maxHeight: 30, marginBottom: 8 }}
                            >
                                {packs.map((p) => (
                                    <RN.TouchableOpacity
                                        key={p}
                                        onPress={() => setSelectedPack(p)}
                                        style={{
                                            paddingHorizontal: 10,
                                            paddingVertical: 4,
                                            backgroundColor:
                                                selectedPack === p ? "#5865F2" : "rgba(255,255,255,0.08)",
                                            borderRadius: 10,
                                            marginRight: 6,
                                        }}
                                    >
                                        <RN.Text style={{ color: "#fff", fontSize: 11 }}>{p}</RN.Text>
                                    </RN.TouchableOpacity>
                                ))}
                            </RN.ScrollView>
                        )}

                        <RN.ScrollView
                            style={{ flex: 1 }}
                            keyboardShouldPersistTaps="always"
                            showsVerticalScrollIndicator={true}
                        >
                            {filteredEmojis.length === 0 ? (
                                <RN.View style={{ paddingVertical: 24, alignItems: "center" }}>
                                    <RN.Text style={{ color: "#888", fontSize: 13 }}>
                                        {emojis.length === 0
                                            ? "No emojis cached. Click Resync to load from bot!"
                                            : "No emojis match your search."}
                                    </RN.Text>
                                </RN.View>
                            ) : (
                                <RN.View
                                    style={{
                                        flexDirection: "row",
                                        flexWrap: "wrap",
                                        gap: 8,
                                        paddingBottom: 16,
                                    }}
                                >
                                    {filteredEmojis.map((emoji) => {
                                        const url = getEmojiCdnUrl(emoji.id, Boolean(emoji.animated));
                                        return (
                                            <RN.TouchableOpacity
                                                key={emoji.id}
                                                onPress={() => insertEmojiIntoDraft(emoji)}
                                                activeOpacity={0.7}
                                                style={{
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    backgroundColor: "rgba(255,255,255,0.06)",
                                                    borderRadius: 8,
                                                    width: 44,
                                                    height: 44,
                                                }}
                                            >
                                                <RN.Image
                                                    source={{ uri: url }}
                                                    style={{ width: 32, height: 32 }}
                                                    resizeMode="contain"
                                                />
                                            </RN.TouchableOpacity>
                                        );
                                    })}
                                </RN.View>
                            )}
                        </RN.ScrollView>
                    </RN.View>
                ) : (
                    /* Tab 2: Packs Market */
                    <RN.ScrollView
                        style={{ flex: 1 }}
                        keyboardShouldPersistTaps="always"
                        showsVerticalScrollIndicator={true}
                    >
                        {loadingPacks && (
                            <RN.Text style={{ color: "#aaa", textAlign: "center", marginVertical: 16 }}>
                                Loading remote packs...
                            </RN.Text>
                        )}
                        {!loadingPacks && remotePacks.length === 0 && (
                            <RN.Text style={{ color: "#aaa", textAlign: "center", marginVertical: 16 }}>
                                No remote packs available.
                            </RN.Text>
                        )}
                        {remotePacks.map((pack) => {
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
                                        backgroundColor: "rgba(255,255,255,0.05)",
                                        borderRadius: 10,
                                        padding: 10,
                                        marginBottom: 10,
                                        borderWidth: 1,
                                        borderColor: "rgba(255,255,255,0.08)",
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
                                            backgroundColor: "rgba(0,0,0,0.25)",
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
                        })}
                    </RN.ScrollView>
                )}
            </RN.View>
        </ActionSheet>
    );
}
