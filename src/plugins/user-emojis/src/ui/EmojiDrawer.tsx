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
import { openEmojiModal, registerDrawerToggle, setDrawerOpenState } from "../utils/navigation";

export default function EmojiDrawer({ inputProps }: { inputProps?: any }) {
    const [isOpen, setIsOpen] = React.useState(false);
    const [search, setSearch] = React.useState("");
    const [selectedPack, setSelectedPack] = React.useState("All");
    const isSearchFocusedRef = React.useRef(false);

    const emojis: AppEmoji[] = storage.emojis || [];
    const DRAWER_HEIGHT = 340;

    React.useEffect(() => {
        registerDrawerToggle(setIsOpen);
        preloadRemotePacks();

        const kbShow = RN.Keyboard.addListener("keyboardDidShow", () => {
            if (!isSearchFocusedRef.current) {
                setIsOpen(false);
            }
        });
        const kbWillShow = RN.Keyboard.addListener("keyboardWillShow", () => {
            if (!isSearchFocusedRef.current) {
                setIsOpen(false);
            }
        });

        return () => {
            registerDrawerToggle(null);
            kbShow.remove();
            kbWillShow.remove();
        };
    }, []);

    React.useEffect(() => {
        setDrawerOpenState(isOpen);
    }, [isOpen]);

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
                    onPress={() => insertEmojiIntoDraft(item, inputProps)}
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
                        style={{ width: 32, height: 32 }}
                        resizeMode="contain"
                    />
                </RN.TouchableOpacity>
            );
        },
        [inputProps]
    );

    if (!isOpen) return null;

    return (
        <RN.View
            style={{
                height: DRAWER_HEIGHT,
                maxHeight: DRAWER_HEIGHT,
                backgroundColor: "#1e1f22",
                borderTopWidth: 1,
                borderTopColor: "rgba(255, 255, 255, 0.12)",
                paddingHorizontal: 8,
                paddingVertical: 6,
                display: "flex",
                flexDirection: "column",
            }}
        >
            {/* Header bar: count, Market cart button, Resync button, Close button */}
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
                <RN.Text style={{ color: "#ffffff", fontSize: 13, fontWeight: "bold" }}>
                    💎 Custom Emojis ({emojis.length})
                </RN.Text>

                <RN.View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    {/* Market Button */}
                    <RN.TouchableOpacity
                        onPress={() => {
                            openEmojiModal();
                        }}
                        style={{
                            paddingVertical: 5,
                            paddingHorizontal: 10,
                            backgroundColor: "rgba(255, 255, 255, 0.08)",
                            borderRadius: 8,
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 4,
                        }}
                    >
                        <RN.Text style={{ fontSize: 14 }}>🛒</RN.Text>
                        <RN.Text style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>Market</RN.Text>
                    </RN.TouchableOpacity>

                    {/* Resync Button (Bigger & Prominent) */}
                    <RN.TouchableOpacity
                        onPress={() => syncEmojisFromBot(true)}
                        style={{
                            paddingVertical: 5,
                            paddingHorizontal: 12,
                            backgroundColor: "rgba(88, 101, 242, 0.25)",
                            borderRadius: 8,
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 4,
                        }}
                    >
                        <RN.Text style={{ color: "#5865F2", fontSize: 12, fontWeight: "bold" }}>
                            🔄 Resync
                        </RN.Text>
                    </RN.TouchableOpacity>

                    {/* Close Button */}
                    <RN.TouchableOpacity
                        onPress={() => setIsOpen(false)}
                        style={{
                            paddingHorizontal: 10,
                            paddingVertical: 5,
                            borderRadius: 8,
                            backgroundColor: "rgba(255, 255, 255, 0.08)",
                        }}
                    >
                        <RN.Text style={{ color: "#fff", fontSize: 13, fontWeight: "bold" }}>✕</RN.Text>
                    </RN.TouchableOpacity>
                </RN.View>
            </RN.View>

            {/* Search Input */}
            <RN.TextInput
                value={search}
                placeholder="Search emojis..."
                placeholderTextColor="#888"
                onFocus={() => {
                    isSearchFocusedRef.current = true;
                }}
                onBlur={() => {
                    isSearchFocusedRef.current = false;
                }}
                onChangeText={(txt: string) => setSearch(txt)}
                style={{
                    backgroundColor: "rgba(0, 0, 0, 0.35)",
                    color: "#fff",
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 8,
                    fontSize: 13,
                    marginTop: 6,
                    marginBottom: 6,
                }}
            />

            {/* Category Pills */}
            {packs.length > 2 && (
                <RN.ScrollView
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
                </RN.ScrollView>
            )}

            {/* Emoji Grid (Fluid Scrolling) */}
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
                    key="emoji-grid-cols-7"
                    data={filteredEmojis}
                    keyExtractor={(item) => item.id}
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
                    contentContainerStyle={{ paddingBottom: 16 }}
                />
            )}
        </RN.View>
    );
}
