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
        // 1. Search (Autocomplete & Query Matches)
        if (typeof EmojiStore.searchWithoutFetchingLatest === "function") {
            unpatches.push(
                instead("searchWithoutFetchingLatest", EmojiStore, (args, orig) => {
                    const [opts] = args;
                    const result = orig.apply(EmojiStore, args) || {};
                    const query = String(opts?.query ?? "").toLowerCase();
                    const loaded: AppEmoji[] = storage.emojis || [];

                    if (!query || !loaded.length) return result;

                    const customMatches = loaded
                        .filter((e) => e.name.toLowerCase().includes(query))
                        .map((e) => buildEmojiObj(e));

                    if (!customMatches.length) return result;

                    if (Array.isArray(result)) {
                        return [...customMatches, ...result];
                    }

                    if (typeof result === "object") {
                        if (!Array.isArray(result.unlocked)) result.unlocked = [];
                        const existingIds = new Set(result.unlocked.map((e: any) => String(e?.id ?? "")));
                        for (const m of customMatches) {
                            if (!existingIds.has(m.id)) {
                                result.unlocked.unshift(m);
                            }
                        }
                        if (Array.isArray(result.emojis)) {
                            result.emojis.unshift(...customMatches);
                        }
                    }

                    return result;
                })
            );
            logStatus("Patched EmojiStore.searchWithoutFetchingLatest");
        }

        // 2. getCustomEmojiById & getUsableCustomEmojiById
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

        // 3. getByName & getUsableEmojiByAnyName & getCustomEmojisByName
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
        if (typeof EmojiStore.getCustomEmojisByName === "function") {
            unpatches.push(
                instead("getCustomEmojisByName", EmojiStore, (args, orig) => {
                    const [name] = args;
                    const res = orig.apply(EmojiStore, args) || {};
                    const loaded: AppEmoji[] = storage.emojis || [];
                    const found = loaded.find((e) => e.name.toLowerCase() === String(name).toLowerCase());
                    if (found) {
                        const obj = buildEmojiObj(found);
                        if (Array.isArray(res)) {
                            res.push(obj);
                        } else if (typeof res === "object") {
                            res[found.id] = obj;
                        }
                    }
                    return res;
                })
            );
        }

        // 4. isEmojiUsable & isEmojiFilteredOrLocked & isEmojiDisabled & isEmojiPremiumLocked
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

        // 5. getGuildEmoji
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

        // 6. getDisambiguatedEmojiContext
        if (typeof EmojiStore.getDisambiguatedEmojiContext === "function") {
            unpatches.push(
                after("getDisambiguatedEmojiContext", EmojiStore, (_, res) => {
                    const loaded: AppEmoji[] = storage.emojis || [];
                    if (!loaded.length || !res) return res;
                    const customObjects = loaded.map((e) => buildEmojiObj(e));

                    if (Array.isArray(res?.emojis)) {
                        for (const emoji of customObjects) {
                            if (!res.emojis.some((e: any) => e?.id === emoji.id)) {
                                res.emojis.push(emoji);
                            }
                        }
                    }
                    if (Array.isArray(res?.usableEmojis)) {
                        for (const emoji of customObjects) {
                            if (!res.usableEmojis.some((e: any) => e?.id === emoji.id)) {
                                res.usableEmojis.push(emoji);
                            }
                        }
                    }
                    return res;
                })
            );
        }

        // 7. getEmojis (handles both flat array and guild-keyed dictionary)
        if (typeof EmojiStore.getEmojis === "function") {
            unpatches.push(
                after("getEmojis", EmojiStore, (_, res) => {
                    const loaded: AppEmoji[] = storage.emojis || [];
                    if (!loaded.length || !res) return res;
                    const customObjects = loaded.map((e) => buildEmojiObj(e));

                    if (Array.isArray(res)) {
                        for (const emoji of customObjects) {
                            if (!res.some((e: any) => e?.id === emoji.id)) {
                                res.push(emoji);
                            }
                        }
                    } else if (typeof res === "object") {
                        if (!Array.isArray(res["UserAppEmojis"])) {
                            res["UserAppEmojis"] = [];
                        }
                        res["UserAppEmojis"] = customObjects;
                        if (!Array.isArray(res["custom"])) {
                            res["custom"] = [];
                        }
                        for (const emoji of customObjects) {
                            if (!res["custom"].some((e: any) => e?.id === emoji.id)) {
                                res["custom"].push(emoji);
                            }
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
