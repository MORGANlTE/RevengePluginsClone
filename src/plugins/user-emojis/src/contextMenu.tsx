import { findByProps } from "@vendetta/metro";
import { React } from "@vendetta/metro/common";
import { after, before } from "@vendetta/patcher";
import { showToast } from "@vendetta/ui/toasts";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { findInReactTree } from "@vendetta/utils";

import { LazyActionSheet, hideActionSheet } from "$/components/ActionSheet";
import { RedesignRow } from "@nexpid/vdp-shared";

import { insertTextIntoChat } from "./utils";

export function patchMessageActionSheet(getAppState: () => any) {
    return before("openLazy", LazyActionSheet, ([component, key, msg]) => {
        const message = msg?.message;
        if (key !== "MessageLongPressActionSheet" || !message) return;

        component.then((i: any) => {
            const unp = after("default", i, (_, comp) => {
                React.useEffect(() => { return () => { unp(); }; }, []);

                const buttons = findInReactTree(comp, x => x[0]?.type?.name === "ButtonRow");
                if (!buttons) return comp;

                const app = getAppState().selectedApp;
                
                // Edit Bot Message Button
                if (message.author?.bot && app && message.author.id === app.appId) {
                    buttons.splice(1, 0, React.createElement(RedesignRow, {
                        label: "Edit Bot Message",
                        icon: getAssetIDByName("PencilIcon"),
                        onPress: () => {
                            insertTextIntoChat(`/ed `);
                            showToast("Inserted /ed command. Send to trigger modal.", getAssetIDByName("PencilIcon"));
                            hideActionSheet();
                        }
                    }));
                }

                // Steal Emojis Button
                const emojiRegex = /<a?:([A-Za-z0-9_]+):(\d+)>/g;
                const foundEmojis: { name: string; id: string; raw: string }[] = [];
                let match;

                if (message.content) {
                    while ((match = emojiRegex.exec(message.content)) !== null) {
                        if (!foundEmojis.find((e) => e.id === match![2])) {
                            foundEmojis.push({ name: match[1], id: match[2], raw: match[0] });
                        }
                    }
                }

                if (foundEmojis.length > 0) {
                    foundEmojis.forEach(e => {
                        buttons.splice(1, 0, React.createElement(RedesignRow, {
                            label: `Steal :${e.name}:`,
                            icon: getAssetIDByName("ImagePlusIcon"),
                            onPress: () => {
                                if (!app) {
                                    showToast("No bot selected!", getAssetIDByName("Small"));
                                    hideActionSheet();
                                    return;
                                }
                                insertTextIntoChat(`/stealemoji emoji:${e.raw} new_name:`);
                                showToast(`Drafted command for :${e.name}:`, getAssetIDByName("Check"));
                                hideActionSheet();
                            }
                        }));
                    });
                }
            });
        });
    });
}
