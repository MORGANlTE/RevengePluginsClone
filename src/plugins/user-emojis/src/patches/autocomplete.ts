import { findByProps, findByStoreName } from "@vendetta/metro";
import { after, instead } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { AppEmoji } from "../types";
import { buildEmojiObj, getEmojiCdnUrl, USER_PICKER_CATEGORY } from "../utils/botApi";
import { logStatus } from "../utils/logger";

export function patchAutocomplete(): () => void {
    const unpatches: (() => void)[] = [];

    const GuildStore = findByStoreName("GuildStore");
    const EmojiStore = findByStoreName("EmojiStore") || findByProps("getCustomEmojiById", "getEmojis");

    // 1. GuildStore Mocks & Cache Injection
    if (GuildStore) {
        if (typeof GuildStore.getGuild === "function") {
            unpatches.push(
                instead("getGuild", GuildStore, (args, orig) => {
                    if (args[0] === "UserAppEmojis") {
                        const loaded: AppEmoji[] = storage.emojis || [];
                        return {
                            id: "UserAppEmojis",
                            name: "User App Emojis",
                            getIconURL: () => null,
                            emojis: loaded.map((e) => e.id),
                        };
                    }
                    return orig.apply(GuildStore, args);
                })
            );
        }
        if (typeof GuildStore.getGuilds === "function") {
            unpatches.push(
                after("getGuilds", GuildStore, (_, res) => {
                    if (res && typeof res === "object") {
                        const loaded: AppEmoji[] = storage.emojis || [];
                        res["UserAppEmojis"] = {
                            id: "UserAppEmojis",
                            name: "User App Emojis",
                            getIconURL: () => null,
                            emojis: loaded.map((e) => e.id),
                        };
                    }
                    return res;
                })
            );
        }
        if (typeof GuildStore.getGuildIds === "function") {
            unpatches.push(
                after("getGuildIds", GuildStore, (_, res) => {
                    if (Array.isArray(res) && !res.includes("UserAppEmojis")) {
                        res.push("UserAppEmojis");
                    }
                    return res;
                })
            );
        }
        logStatus("Patched GuildStore mock for UserAppEmojis");
    }

    // 2. Individual Nitro / Permission Bypasses (Each queried independently for 100% resolution)
    const canUseEmojisEverywhereMod = findByProps("canUseEmojisEverywhere");
    if (canUseEmojisEverywhereMod && typeof canUseEmojisEverywhereMod.canUseEmojisEverywhere === "function") {
        unpatches.push(instead("canUseEmojisEverywhere", canUseEmojisEverywhereMod, () => true));
    }

    const canUseCustomEmojisEverywhereMod = findByProps("canUseCustomEmojisEverywhere");
    if (canUseCustomEmojisEverywhereMod && typeof canUseCustomEmojisEverywhereMod.canUseCustomEmojisEverywhere === "function") {
        unpatches.push(instead("canUseCustomEmojisEverywhere", canUseCustomEmojisEverywhereMod, () => true));
    }

    const canUseAnimatedEmojisMod = findByProps("canUseAnimatedEmojis");
    if (canUseAnimatedEmojisMod && typeof canUseAnimatedEmojisMod.canUseAnimatedEmojis === "function") {
        unpatches.push(instead("canUseAnimatedEmojis", canUseAnimatedEmojisMod, () => true));
    }

    const canUseExternalEmojisMod = findByProps("canUseExternalEmojis");
    if (canUseExternalEmojisMod && typeof canUseExternalEmojisMod.canUseExternalEmojis === "function") {
        unpatches.push(instead("canUseExternalEmojis", canUseExternalEmojisMod, () => true));
    }

    const canUseCustomEmojisMod = findByProps("canUseCustomEmojis");
    if (canUseCustomEmojisMod && typeof canUseCustomEmojisMod.canUseCustomEmojis === "function") {
        unpatches.push(instead("canUseCustomEmojis", canUseCustomEmojisMod, () => true));
    }

    const isEmojiFilteredMod = findByProps("isEmojiFilteredOrLocked");
    if (isEmojiFilteredMod && typeof isEmojiFilteredMod.isEmojiFilteredOrLocked === "function") {
        unpatches.push(
            instead("isEmojiFilteredOrLocked", isEmojiFilteredMod, (args, orig) => {
                const [emoji] = args;
                const loaded: AppEmoji[] = storage.emojis || [];
                if (emoji && loaded.some((e) => e.id === emoji.id)) return false;
                return orig.apply(isEmojiFilteredMod, args);
            })
        );
    }

    const isEmojiDisabledMod = findByProps("isEmojiDisabled");
    if (isEmojiDisabledMod && typeof isEmojiDisabledMod.isEmojiDisabled === "function") {
        unpatches.push(
            instead("isEmojiDisabled", isEmojiDisabledMod, (args, orig) => {
                const [emoji] = args;
                const loaded: AppEmoji[] = storage.emojis || [];
                if (emoji && loaded.some((e) => e.id === emoji.id)) return false;
                return orig.apply(isEmojiDisabledMod, args);
            })
        );
    }

    const isEmojiPremiumLockedMod = findByProps("isEmojiPremiumLocked");
    if (isEmojiPremiumLockedMod && typeof isEmojiPremiumLockedMod.isEmojiPremiumLocked === "function") {
        unpatches.push(
            instead("isEmojiPremiumLocked", isEmojiPremiumLockedMod, (args, orig) => {
                const [emoji] = args;
                const loaded: AppEmoji[] = storage.emojis || [];
                if (emoji && loaded.some((e) => e.id === emoji.id)) return false;
                return orig.apply(isEmojiPremiumLockedMod, args);
            })
        );
    }

    const getEmojiUnavailableReasonMod = findByProps("getEmojiUnavailableReason");
    if (getEmojiUnavailableReasonMod && typeof getEmojiUnavailableReasonMod.getEmojiUnavailableReason === "function") {
        unpatches.push(
            instead("getEmojiUnavailableReason", getEmojiUnavailableReasonMod, (args, orig) => {
                const [emoji] = args;
                const loaded: AppEmoji[] = storage.emojis || [];
                if (emoji && loaded.some((e) => e.id === emoji.id)) return null;
                return orig.apply(getEmojiUnavailableReasonMod, args);
            })
        );
    }

    // 3. Emoji URL Resolution Bypass
    const emojiUrlMods = [
        findByProps("getEmojiURL"),
        findByProps("getCustomEmojiUrl"),
        findByProps("getEmojiUrl"),
    ];
    for (const mod of emojiUrlMods) {
        if (!mod) continue;
        for (const fn of ["getEmojiURL", "getCustomEmojiUrl", "getEmojiUrl"]) {
            if (typeof mod[fn] === "function") {
                unpatches.push(
                    instead(fn, mod, (args, orig) => {
                        const first = args[0];
                        const id = typeof first === "object" ? first?.id : first;
                        const animated = typeof first === "object" ? Boolean(first?.animated) : Boolean(args[1]);
                        const loaded: AppEmoji[] = storage.emojis || [];
                        const found = loaded.find((e) => e.id === id);
                        if (found) {
                            return getEmojiCdnUrl(found.id, Boolean(found.animated || animated));
                        }
                        return orig.apply(mod, args);
                    })
                );
            }
        }
    }
    logStatus("Patched all emoji permission and URL modules");

    // 4. Comprehensive EmojiStore Interception
    if (EmojiStore) {
        // Search (Autocomplete & Query Matches)
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

        // getCustomEmojiById & getUsableCustomEmojiById
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

        // getByName & getUsableEmojiByAnyName & getCustomEmojisByName
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

        // isEmojiUsable & isEmojiFilteredOrLocked & isEmojiDisabled & isEmojiPremiumLocked
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

        // getGuildEmoji
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

        // getDisambiguatedEmojiContext
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

        // getEmojis
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
