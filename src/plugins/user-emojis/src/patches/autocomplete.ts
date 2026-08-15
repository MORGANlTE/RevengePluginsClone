import { findByProps, findByStoreName } from "@vendetta/metro";
import { after, instead } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { AppEmoji } from "../types";
import { buildEmojiObj, USER_PICKER_CATEGORY } from "../utils/botApi";
import { logStatus } from "../utils/logger";

export function patchAutocomplete(): () => void {
    const unpatches: (() => void)[] = [];

    const GuildStore = findByStoreName("GuildStore");
    const EmojiStore = findByStoreName("EmojiStore") || findByProps("getCustomEmojiById", "getEmojis");
    const EmojiPermissions =
        findByProps("canUseEmojisEverywhere", "canUseAnimatedEmojis") ||
        findByProps("canUseCustomEmojisEverywhere") ||
        findByProps("isEmojiFilteredOrLocked");

    if (GuildStore?.getGuild) {
        unpatches.push(
            instead("getGuild", GuildStore, (args, orig) => {
                if (args[0] === "UserAppEmojis") {
                    return {
                        id: "UserAppEmojis",
                        name: "User App Plugin",
                        getIconURL: () => null,
                    };
                }
                return orig.apply(GuildStore, args);
            })
        );
        logStatus("Patched GuildStore mock for UserAppEmojis");
    } else {
        logStatus("Failed to find GuildStore", true);
    }

    // Unlocks emoji permissions globally for chat input rendering
    if (EmojiPermissions) {
        if (typeof EmojiPermissions.canUseEmojisEverywhere === "function") {
            unpatches.push(instead("canUseEmojisEverywhere", EmojiPermissions, () => true));
        }
        if (typeof EmojiPermissions.canUseCustomEmojisEverywhere === "function") {
            unpatches.push(instead("canUseCustomEmojisEverywhere", EmojiPermissions, () => true));
        }
        if (typeof EmojiPermissions.canUseAnimatedEmojis === "function") {
            unpatches.push(instead("canUseAnimatedEmojis", EmojiPermissions, () => true));
        }
        if (typeof EmojiPermissions.isEmojiFilteredOrLocked === "function") {
            unpatches.push(
                instead("isEmojiFilteredOrLocked", EmojiPermissions, (args, orig) => {
                    const [emoji] = args;
                    const loaded: AppEmoji[] = storage.emojis || [];
                    if (emoji && loaded.some((e) => e.id === emoji.id)) return false;
                    return orig.apply(EmojiPermissions, args);
                })
            );
        }
        if (typeof EmojiPermissions.isEmojiDisabled === "function") {
            unpatches.push(
                instead("isEmojiDisabled", EmojiPermissions, (args, orig) => {
                    const [emoji] = args;
                    const loaded: AppEmoji[] = storage.emojis || [];
                    if (emoji && loaded.some((e) => e.id === emoji.id)) return false;
                    return orig.apply(EmojiPermissions, args);
                })
            );
        }
        logStatus("Patched EmojiPermissions for in-chatbar emoji rendering");
    }

    if (EmojiStore) {
        // 1. Search (Autocomplete)
        if (typeof EmojiStore.searchWithoutFetchingLatest === "function") {
            unpatches.push(
                instead("searchWithoutFetchingLatest", EmojiStore, (args, orig) => {
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
            logStatus("Patched EmojiStore.searchWithoutFetchingLatest");
        }

        // 2. getCustomEmojiById
        if (typeof EmojiStore.getCustomEmojiById === "function") {
            unpatches.push(
                instead("getCustomEmojiById", EmojiStore, (args, orig) => {
                    const [id] = args;
                    const loaded: AppEmoji[] = storage.emojis || [];
                    const found = loaded.find((e) => e.id === id);
                    if (found) return buildEmojiObj(found);
                    return orig.apply(EmojiStore, args);
                })
            );
            logStatus("Patched EmojiStore.getCustomEmojiById");
        }

        // 3. getUsableCustomEmojiById
        if (typeof EmojiStore.getUsableCustomEmojiById === "function") {
            unpatches.push(
                instead("getUsableCustomEmojiById", EmojiStore, (args, orig) => {
                    const [id] = args;
                    const loaded: AppEmoji[] = storage.emojis || [];
                    const found = loaded.find((e) => e.id === id);
                    if (found) return buildEmojiObj(found);
                    return orig.apply(EmojiStore, args);
                })
            );
            logStatus("Patched EmojiStore.getUsableCustomEmojiById");
        }

        // 4. getByName & getUsableEmojiByAnyName
        if (typeof EmojiStore.getByName === "function") {
            unpatches.push(
                instead("getByName", EmojiStore, (args, orig) => {
                    const [name] = args;
                    const loaded: AppEmoji[] = storage.emojis || [];
                    const found = loaded.find((e) => e.name.toLowerCase() === String(name).toLowerCase());
                    if (found) return buildEmojiObj(found);
                    return orig.apply(EmojiStore, args);
                })
            );
            logStatus("Patched EmojiStore.getByName");
        }
        if (typeof EmojiStore.getUsableEmojiByAnyName === "function") {
            unpatches.push(
                instead("getUsableEmojiByAnyName", EmojiStore, (args, orig) => {
                    const [name] = args;
                    const loaded: AppEmoji[] = storage.emojis || [];
                    const found = loaded.find((e) => e.name.toLowerCase() === String(name).toLowerCase());
                    if (found) return buildEmojiObj(found);
                    return orig.apply(EmojiStore, args);
                })
            );
            logStatus("Patched EmojiStore.getUsableEmojiByAnyName");
        }

        // 5. isEmojiUsable
        if (typeof EmojiStore.isEmojiUsable === "function") {
            unpatches.push(
                instead("isEmojiUsable", EmojiStore, (args, orig) => {
                    const [emoji] = args;
                    const loaded: AppEmoji[] = storage.emojis || [];
                    if (emoji && loaded.some((e) => e.id === emoji.id)) {
                        return true;
                    }
                    return orig.apply(EmojiStore, args);
                })
            );
            logStatus("Patched EmojiStore.isEmojiUsable");
        }

        // 6. isEmojiFilteredOrLocked & isEmojiDisabled & isEmojiPremiumLocked
        if (typeof EmojiStore.isEmojiFilteredOrLocked === "function") {
            unpatches.push(
                instead("isEmojiFilteredOrLocked", EmojiStore, (args, orig) => {
                    const [emoji] = args;
                    const loaded: AppEmoji[] = storage.emojis || [];
                    if (emoji && loaded.some((e) => e.id === emoji.id)) {
                        return false;
                    }
                    return orig.apply(EmojiStore, args);
                })
            );
        }
        if (typeof EmojiStore.isEmojiDisabled === "function") {
            unpatches.push(
                instead("isEmojiDisabled", EmojiStore, (args, orig) => {
                    const [emoji] = args;
                    const loaded: AppEmoji[] = storage.emojis || [];
                    if (emoji && loaded.some((e) => e.id === emoji.id)) {
                        return false;
                    }
                    return orig.apply(EmojiStore, args);
                })
            );
        }
        if (typeof EmojiStore.isEmojiPremiumLocked === "function") {
            unpatches.push(
                instead("isEmojiPremiumLocked", EmojiStore, (args, orig) => {
                    const [emoji] = args;
                    const loaded: AppEmoji[] = storage.emojis || [];
                    if (emoji && loaded.some((e) => e.id === emoji.id)) {
                        return false;
                    }
                    return orig.apply(EmojiStore, args);
                })
            );
        }

        // 7. getGuildEmoji
        if (typeof EmojiStore.getGuildEmoji === "function") {
            unpatches.push(
                instead("getGuildEmoji", EmojiStore, (args, orig) => {
                    if (args[0] === "UserAppEmojis") {
                        const loaded: AppEmoji[] = storage.emojis || [];
                        return loaded.map((e) => buildEmojiObj(e));
                    }
                    return orig.apply(EmojiStore, args);
                })
            );
        }

        // 8. getEmojis
        if (typeof EmojiStore.getEmojis === "function") {
            unpatches.push(
                after("getEmojis", EmojiStore, (_, res) => {
                    const loaded: AppEmoji[] = storage.emojis || [];
                    if (Array.isArray(res) && loaded.length > 0) {
                        for (const emoji of loaded) {
                            res.push(buildEmojiObj(emoji));
                        }
                    }
                    return res;
                })
            );
            logStatus("Patched EmojiStore.getEmojis");
        }
    } else {
        logStatus("Failed to find EmojiStore", true);
    }

    return () => unpatches.forEach((u) => u?.());
}
