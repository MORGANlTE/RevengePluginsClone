import { React, ReactNative as RN } from "@vendetta/metro/common";
import { Forms } from "@vendetta/ui/components";
import { storage } from "@vendetta/plugin";
import { showToast } from "@vendetta/ui/toasts";
import { findByProps } from "@vendetta/metro";
import { dispatchAppCommand } from "./index";
import type { AppEmoji, EmojiPack } from "./types";

const { FormRow, FormSection, FormInput } = Forms;
const MessageActions = findByProps("sendMessage");
const SelectedChannelStore = findByProps("getChannelId");

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
            const url = storage.packIndexUrl || "https://raw.githubusercontent.com/username/repo/main/packs_index.json";
            fetch(url)
                .then((res) => res.json())
                .then((data) => setRemotePacks(Array.isArray(data) ? data : []))
                .catch(() => showToast("Failed to fetch emoji packs", 2))
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

    const handleSendEmoji = (emoji: AppEmoji) => {
        const channelId = SelectedChannelStore?.getChannelId();
        if (!channelId) return;
        const tag = `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
        try {
            MessageActions.sendMessage(channelId, { content: tag });
        } catch {
            RN.Clipboard.setString(tag);
            showToast("Copied to clipboard!", 1);
        }
    };

    return (
        <RN.ScrollView style={{ flex: 1, backgroundColor: "#1e1f22", padding: 12 }}>
            <RN.View style={{ flexDirection: "row", justifyContent: "space-around", marginBottom: 12 }}>
                <RN.TouchableOpacity
                    onPress={() => setTab("emojis")}
                    style={{
                        paddingVertical: 8,
                        paddingHorizontal: 20,
                        backgroundColor: tab === "emojis" ? "#5865F2" : "rgba(255,255,255,0.1)",
                        borderRadius: 8,
                    }}
                >
                    <RN.Text style={{ color: "#fff", fontWeight: "bold" }}>Emojis</RN.Text>
                </RN.TouchableOpacity>
                <RN.TouchableOpacity
                    onPress={() => setTab("market")}
                    style={{
                        paddingVertical: 8,
                        paddingHorizontal: 20,
                        backgroundColor: tab === "market" ? "#5865F2" : "rgba(255,255,255,0.1)",
                        borderRadius: 8,
                    }}
                >
                    <RN.Text style={{ color: "#fff", fontWeight: "bold" }}>Market</RN.Text>
                </RN.TouchableOpacity>
            </RN.View>

            {tab === "emojis" ? (
                <>
                    <FormInput
                        title="Search Emojis"
                        value={search}
                        placeholder="Filter by name..."
                        onChange={setSearch}
                    />
                    <RN.View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 12 }}>
                        {filteredEmojis.map((emoji) => {
                            const url = `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}?size=48&quality=lossless`;
                            return (
                                <RN.TouchableOpacity
                                    key={emoji.id}
                                    onPress={() => handleSendEmoji(emoji)}
                                    style={{
                                        alignItems: "center",
                                        justifyContent: "center",
                                        padding: 6,
                                        backgroundColor: "rgba(255,255,255,0.06)",
                                        borderRadius: 8,
                                    }}
                                >
                                    <RN.Image
                                        source={{ uri: url }}
                                        style={{ width: 36, height: 36 }}
                                        resizeMode="contain"
                                    />
                                    <RN.Text
                                        style={{ color: "#fff", fontSize: 10, marginTop: 4, maxWidth: 50 }}
                                        numberOfLines={1}
                                    >
                                        {emoji.name}
                                    </RN.Text>
                                </RN.TouchableOpacity>
                            );
                        })}
                    </RN.View>
                </>
            ) : (
                <FormSection title="Pack Market">
                    {loadingPacks && <RN.Text style={{ color: "#aaa", textAlign: "center" }}>Loading packs...</RN.Text>}
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
                                        }}
                                        style={{
                                            backgroundColor: isInstalled ? "#ED4245" : "#5865F2",
                                            paddingVertical: 6,
                                            paddingHorizontal: 12,
                                            borderRadius: 6,
                                        }}
                                    >
                                        <RN.Text style={{ color: "#fff", fontSize: 12, fontWeight: "bold" }}>
                                            {isInstalled ? "Uninstall" : "Install"}
                                        </RN.Text>
                                    </RN.TouchableOpacity>
                                )}
                            />
                        );
                    })}
                </FormSection>
            )}
        </RN.ScrollView>
    );
}
