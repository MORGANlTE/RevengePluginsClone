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
    const EmojiPermissions = findByProps("canUseEmojisEverywhere", "canUseAnimatedEmojis") ||
        findByProps("canUseCustomEmojisEverywhere") ||
        findByProps("isEmojiFilteredOrLocked");

    if (GuildStore?.getGuild) {
        unpatches.push(
            instead("getGuild", GuildStore, (args, orig) => {
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
        logStatus("Patched GuildStore mock for UserAppEmojis");
    } else {
        logStatus("Failed to find GuildStore", true);
    }

    // Unlocks emoji rendering permissions in chat input
    if (EmojiPermissions) {
        if (typeof EmojiPermissions.canUseEmojisEverywhere === "function") {
            unpatches.push(
                instead("canUseEmojisEverywhere", EmojiPermissions, () => true)
            );
        }
        if (typeof EmojiPermissions.canUseCustomEmojisEverywhere === "function") {
            unpatches.push(
                instead("canUseCustomEmojisEverywhere", EmojiPermissions, () => true)
            );
        }
        if (typeof EmojiPermissions.canUseAnimatedEmojis === "function") {
            unpatches.push(
                instead("canUseAnimatedEmojis", EmojiPermissions, () => true)
            );
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
        logStatus("Patched EmojiPermissions for in-chatbar emoji rendering");
    }

    if (EmojiStore) {
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
