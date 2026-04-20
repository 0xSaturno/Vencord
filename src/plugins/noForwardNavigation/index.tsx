import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";

const ChannelRouter = findByPropsLazy("transitionToChannel");

const settings = definePluginSettings({
    preventNavigation: {
        type: OptionType.BOOLEAN,
        description: "Prevent Discord from automatically navigating to the channel after forwarding a message.",
        default: true
    }
});

let origTransitionToChannel: any = null;

export default definePlugin({
    name: "NoForwardNavigation",
    description: "Prevents Discord from automatically switching channels right after you forward a message.",
    authors: [{ id: 0n, name: "Vencord User" }],
    settings,
    
    start() {
        if (!ChannelRouter) return;

        origTransitionToChannel = ChannelRouter.transitionToChannel;
        ChannelRouter.transitionToChannel = function(...args: any[]) {
            if (settings.store.preventNavigation) {
                const stack = new Error().stack || "";
                if (stack.includes("forward") || stack.includes("Promise.then")) {
                    // Suppress transition triggered by forward action
                    return;
                }
            }
            if (origTransitionToChannel) {
                return origTransitionToChannel.apply(this, args);
            }
        };
    },
    
    stop() {
        if (ChannelRouter && origTransitionToChannel) {
            ChannelRouter.transitionToChannel = origTransitionToChannel;
        }
    }
});
