import { findByProps } from "@vendetta/metro";
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
import { closeEmojiModal } from "../utils/navigation";

const { FormRow } = findByProps("FormRow") ?? {};

export function EmojiStoreModal() {
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
                        <RN.Text style={{ color: "#5865F2", fontSize: 11, fontWeight: "600" }}>Resync</RN.Text>
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
    );
}
