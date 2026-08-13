import { React, ReactNative as RN, stylesheet } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import { semanticColors } from "@vendetta/ui";
import { getAssetIDByName } from "@vendetta/ui/assets";

import { insertTextIntoChat } from "./utils";

const Text = RN.Text;

// A basic button equivalent
function Button({ onPress, text, disabled, color }: { onPress: () => void, text: string, disabled?: boolean, color?: string }) {
    return (
        <RN.TouchableOpacity
            disabled={disabled}
            onPress={onPress}
            style={{
                backgroundColor: disabled ? "gray" : (color || "#5865F2"),
                paddingVertical: 8,
                paddingHorizontal: 16,
                borderRadius: 8,
                alignItems: "center",
                justifyContent: "center",
                opacity: disabled ? 0.6 : 1,
                flex: 1,
            }}
        >
            <Text style={{ color: "white", fontWeight: "bold", fontSize: 14 }}>{text}</Text>
        </RN.TouchableOpacity>
    );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function CustomEmojiStorePopout({ pluginStore, onClose }: { pluginStore: any, onClose: () => void }) {
    const [search, setSearch] = React.useState("");
    const [tab, setTab] = React.useState<"saved" | "store">("saved");
    
    // Remote Store State
    const [storePacks, setStorePacks] = React.useState<any[]>([]);
    const [loadingPacks, setLoadingPacks] = React.useState(false);
    const [pendingInstalls, setPendingInstalls] = React.useState<string[]>([]);
    const bgUrl = pluginStore.getSetting("storeBackground") || "https://i.pinimg.com/236x/2c/cd/9d/2ccd9d9501e6ecbcca340a868ddd1184.jpg";

    React.useEffect(() => {
        if (tab === "store" && storePacks.length === 0) {
            setLoadingPacks(true);
            fetch("https://raw.githubusercontent.com/nexpid/Morganite/main/packs_index.json")
                .then(r => r.json())
                .then(data => {
                    const sorted = (Array.isArray(data) ? data : []).sort((a, b) => 
                        (b.downloads || 0) - (a.downloads || 0)
                    );
                    setStorePacks(sorted);
                })
                .catch(err => {
                    console.error("Failed to load store packs", err);
                    showToast("Failed to load packs", getAssetIDByName("Small"));
                })
                .finally(() => setLoadingPacks(false));
        }
    }, [tab]);

    const allEmojis = Array.from(pluginStore.loadedEmojis.values()) as any[];
    const filteredEmojis = allEmojis.filter((e) =>
        e.name.toLowerCase().includes(search.toLowerCase())
    );

    const handleCopy = (text: string) => {
        insertTextIntoChat(text);
        showToast("Inserted command to chat!", getAssetIDByName("CheckIcon"));
    };

    const styles = stylesheet.createThemedStyleSheet({
        container: {
            flex: 1,
            backgroundColor: semanticColors.BACKGROUND_SECONDARY_ALT,
            maxHeight: RN.Dimensions.get("window").height * 0.7,
            borderRadius: 12,
            overflow: "hidden"
        },
        header: {
            height: 100,
            justifyContent: "center",
            alignItems: "center",
            borderBottomWidth: 1,
            borderBottomColor: "rgba(255,255,255,0.1)",
        },
        headerBg: {
            ...RN.StyleSheet.absoluteFillObject,
            opacity: 0.4
        },
        title: {
            color: "white",
            fontSize: 22,
            fontWeight: "bold",
            textShadowColor: "rgba(0,0,0,0.5)",
            textShadowOffset: { width: 0, height: 2 },
            textShadowRadius: 4,
        },
        tabs: {
            flexDirection: "row",
            backgroundColor: semanticColors.BACKGROUND_TERTIARY,
        },
        tab: {
            flex: 1,
            paddingVertical: 12,
            alignItems: "center",
        },
        activeTab: {
            borderBottomWidth: 2,
            borderBottomColor: "#5865F2"
        },
        tabText: {
            color: semanticColors.TEXT_MUTED,
            fontWeight: "bold",
        },
        activeTabText: {
            color: semanticColors.TEXT_NORMAL,
        },
        content: {
            flex: 1,
            padding: 16,
        },
        searchInput: {
            backgroundColor: semanticColors.BACKGROUND_TERTIARY,
            color: semanticColors.TEXT_NORMAL,
            padding: 10,
            borderRadius: 8,
            marginBottom: 16,
        },
        emojiGrid: {
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 8,
            justifyContent: "center",
        },
        emojiItem: {
            width: 50,
            height: 50,
            backgroundColor: semanticColors.BACKGROUND_TERTIARY,
            borderRadius: 8,
            justifyContent: "center",
            alignItems: "center",
        },
        emojiImage: {
            width: 32,
            height: 32,
        },
        storeHeader: {
            alignItems: "center",
            marginBottom: 20
        },
        storeTitle: {
            fontSize: 18,
            fontWeight: "bold",
            color: "#5865F2",
            marginBottom: 4
        },
        storeDesc: {
            fontSize: 12,
            color: semanticColors.TEXT_MUTED,
        },
        packCard: {
            backgroundColor: semanticColors.BACKGROUND_TERTIARY,
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
        },
        packHeader: {
            flexDirection: "row",
            alignItems: "center",
            marginBottom: 12,
        },
        packIcon: {
            width: 40,
            height: 40,
            borderRadius: 8,
            marginRight: 12,
        },
        packTitle: {
            fontSize: 16,
            fontWeight: "bold",
            color: semanticColors.TEXT_NORMAL,
        },
        packDesc: {
            fontSize: 12,
            color: semanticColors.TEXT_MUTED,
        },
        packEmojis: {
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 6,
            backgroundColor: semanticColors.BACKGROUND_SECONDARY,
            padding: 8,
            borderRadius: 8,
            marginBottom: 16,
        },
        packEmojiImg: {
            width: 28,
            height: 28,
            borderRadius: 4,
        },
        actionsRow: {
            flexDirection: "row",
            gap: 8,
        }
    });

    return (
        <RN.View style={styles.container}>
            <RN.View style={styles.header}>
                <RN.Image source={{ uri: bgUrl }} style={styles.headerBg} resizeMode="cover" />
                <Text style={styles.title}>{pluginStore.getSetting("storeName") || "💎 Custom Emojis"}</Text>
            </RN.View>
            
            <RN.View style={styles.tabs}>
                <RN.TouchableOpacity 
                    style={[styles.tab, tab === "saved" && styles.activeTab]} 
                    onPress={() => setTab("saved")}
                >
                    <Text style={[styles.tabText, tab === "saved" && styles.activeTabText]}>Saved Emojis</Text>
                </RN.TouchableOpacity>
                <RN.TouchableOpacity 
                    style={[styles.tab, tab === "store" && styles.activeTab]} 
                    onPress={() => setTab("store")}
                >
                    <Text style={[styles.tabText, tab === "store" && styles.activeTabText]}>Pack Market</Text>
                </RN.TouchableOpacity>
            </RN.View>

            {tab === "saved" ? (
                <RN.ScrollView style={styles.content}>
                    <RN.TextInput
                        placeholder="Search your custom emojis..."
                        placeholderTextColor={semanticColors.TEXT_MUTED as any}
                        value={search}
                        onChangeText={setSearch}
                        style={styles.searchInput}
                    />
                    
                    {allEmojis.length === 0 ? (
                        <RN.View style={{ alignItems: "center", padding: 20 }}>
                            <Text style={{ color: semanticColors.TEXT_MUTED, textAlign: "center" }}>
                                You haven't added any emojis yet! Use /stealemoji or visit the Pack Market.
                            </Text>
                        </RN.View>
                    ) : (
                        <RN.View style={styles.emojiGrid}>
                            <RN.TouchableOpacity 
                                style={styles.emojiItem}
                                onPress={() => handleCopy(`;random; `)}
                            >
                                <Text style={{ fontSize: 20 }}>🎲</Text>
                            </RN.TouchableOpacity>
                            {filteredEmojis.map(e => (
                                <RN.TouchableOpacity
                                    key={e.id}
                                    style={styles.emojiItem}
                                    onPress={() => handleCopy(`<${e.animated ? "a" : ""}:${e.name}:${e.id}> `)}
                                >
                                    <RN.Image 
                                        source={{ uri: `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? "gif" : "png"}?size=48` }}
                                        style={styles.emojiImage}
                                    />
                                </RN.TouchableOpacity>
                            ))}
                        </RN.View>
                    )}
                </RN.ScrollView>
            ) : (
                <RN.ScrollView style={styles.content}>
                    <RN.View style={styles.storeHeader}>
                        <Text style={styles.storeTitle}>Pack Market</Text>
                        <Text style={styles.storeDesc}>Discover and install community emoji packs instantly.</Text>
                    </RN.View>

                    {loadingPacks ? (
                        <RN.ActivityIndicator size="large" color="#5865F2" style={{ marginTop: 40 }} />
                    ) : (
                        storePacks.map(pack => {
                            const isInstalled = pack.emojis && Object.keys(pack.emojis).some((name: string) =>
                                pluginStore.loadedEmojis.has(name.toLowerCase())
                            );
                            const isPending = pendingInstalls.includes(pack.name);

                            let packIcon = pack.iconUrl || pack.icon;
                            if (packIcon && packIcon.startsWith("<")) {
                                const parts = packIcon.replace(/[<>]/g, "").split(":");
                                const id = parts[parts.length - 1];
                                const isAnimated = parts[0] === "a";
                                packIcon = `https://cdn.discordapp.com/emojis/${id}?size=64&quality=lossless${isAnimated ? "&animated=true" : ""}`;
                            }

                            return (
                                <RN.View key={pack.name} style={styles.packCard}>
                                    <RN.View style={styles.packHeader}>
                                        {packIcon && <RN.Image source={{ uri: packIcon }} style={styles.packIcon} />}
                                        <RN.View style={{ flex: 1 }}>
                                            <Text style={styles.packTitle}>{capitalize(pack.name)}</Text>
                                            <Text style={styles.packDesc}>{pack.description || "No description provided."}</Text>
                                        </RN.View>
                                    </RN.View>

                                    <RN.View style={styles.packEmojis}>
                                        {pack.emojis && Object.entries(pack.emojis).slice(0, 10).map(([name, tag]: any) => {
                                            const parts = tag.replace(/[<>]/g, "").split(":");
                                            const id = parts[parts.length - 1];
                                            const isAnimated = parts[0] === "a";
                                            return (
                                                <RN.Image
                                                    key={id}
                                                    source={{ uri: `https://cdn.discordapp.com/emojis/${id}?size=32&quality=lossless${isAnimated ? "&animated=true" : ""}` }}
                                                    style={styles.packEmojiImg}
                                                />
                                            );
                                        })}
                                        {pack.emojis && Object.keys(pack.emojis).length > 10 && (
                                            <Text style={{ color: "#ccc", fontWeight: "bold", alignSelf: "center", paddingHorizontal: 4 }}>
                                                +{Object.keys(pack.emojis).length - 10}
                                            </Text>
                                        )}
                                    </RN.View>

                                    <RN.View style={styles.actionsRow}>
                                        <Button 
                                            text={isInstalled ? "✅ Installed" : (isPending ? "⏳ Pending..." : "📥 Install Pack")}
                                            color={isInstalled ? "#3ba55c" : "#5865F2"}
                                            disabled={isInstalled || isPending}
                                            onPress={() => {
                                                if (isInstalled || isPending) return;
                                                setPendingInstalls(prev => [...prev, pack.name]);
                                                onClose();
                                                handleCopy(`/installpack pack_name:${pack.name} `);
                                            }}
                                        />
                                        {isInstalled && (
                                            <Button 
                                                text="🗑️ Uninstall"
                                                color="#ed4245"
                                                onPress={() => {
                                                    onClose();
                                                    handleCopy(`/uninstallpack pack_name:${pack.name} `);
                                                }}
                                            />
                                        )}
                                    </RN.View>
                                </RN.View>
                            );
                        })
                    )}
                </RN.ScrollView>
            )}
        </RN.View>
    );
}
