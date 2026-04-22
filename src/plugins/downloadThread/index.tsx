import { addChatBarButton, ChatBarButton, ChatBarProps, removeChatBarButton } from "@api/ChatButtons";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { React, RestAPI, showToast, Toasts } from "@webpack/common";

function DownloadIcon({ isDownloading }: { isDownloading: boolean }) {
    return (
        <svg viewBox="0 0 24 24" width={24} height={24} className="vc-download-thread-icon">
            <path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
        </svg>
    );
}

import { zipSync, strToU8 } from "fflate";

function DownloadButtonRender(props: ChatBarProps) {
    const [isDownloading, setIsDownloading] = React.useState(false);

    // Check if current channel is a thread (forum posts are also threads)
    if (!props.channel || !props.channel.isThread()) return null;
    const currentChannel = props.channel;

    const downloadThread = async () => {
        if (isDownloading) return;
        setIsDownloading(true);
        try {
            let allMessages: any[] = [];
            let lastId: string | null = null;

            while (true) {
                const query: any = { limit: 100 };
                if (lastId) query.before = lastId;

                const res = await RestAPI.get({
                    url: `/channels/${currentChannel.id}/messages`,
                    query
                });

                const msgs = res.body;
                if (!msgs || msgs.length === 0) break;

                allMessages = allMessages.concat(msgs);
                lastId = msgs[msgs.length - 1].id;

                if (msgs.length < 100) break;
            }

            // Format messages in chronological order
            allMessages.reverse();
            let mdContent = `# ${currentChannel.name}\n\n`;

            const zipData: Record<string, any> = {
                "images": {}
            };

            for (const msg of allMessages) {
                const author = msg.author?.username || "Unknown";
                const content = msg.content; // Use raw content as user requested
                mdContent += `**${author}**:\n${content}\n`;

                if (msg.attachments && msg.attachments.length > 0) {
                    for (const att of msg.attachments) {
                        if (att.url) {
                            try {
                                const ext = att.filename.includes('.') ? att.filename.split('.').pop() : 'bin';
                                const name = att.filename.includes('.') ? att.filename.substring(0, att.filename.lastIndexOf('.')) : att.filename;
                                const safeName = `${name}_${att.id}.${ext}`;

                                const res = await fetch(att.url);
                                const buf = await res.arrayBuffer();
                                zipData["images"][safeName] = new Uint8Array(buf);

                                if (att.content_type?.startsWith("image/")) {
                                    mdContent += `\n![${att.filename}](images/${safeName})\n`;
                                } else {
                                    mdContent += `\n[${att.filename}](images/${safeName})\n`;
                                }
                            } catch (e) {
                                console.error("Failed to download attachment", att.url, e);
                                mdContent += `\n[Failed to download: ${att.filename}](${att.url})\n`;
                            }
                        }
                    }
                }
                mdContent += `\n`;
            }

            zipData[`${currentChannel.name}_${currentChannel.id}.md`] = strToU8(mdContent);
            const zipped = zipSync(zipData);

            // Download file
            const blob = new Blob([zipped], { type: "application/zip" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${currentChannel.name}_${currentChannel.id}.zip`;
            a.click();
            URL.revokeObjectURL(url);

            showToast("Thread downloaded successfully!", Toasts.SUCCESS);
        } catch (e) {
            console.error(e);
            showToast("Failed to download thread.", Toasts.FAILURE);
        } finally {
            setIsDownloading(false);
        }
    };

    return (
        <ChatBarButton
            onClick={downloadThread}
            tooltip={isDownloading ? "Downloading..." : "Download Thread"}
        >
            <DownloadIcon isDownloading={isDownloading} />
        </ChatBarButton>
    );
}

export default definePlugin({
    name: "DownloadThread",
    description: "Adds a button to thread chat bar to download the entire thread as a clean markdown file.",
    authors: [{ name: "Saturn", id: 965286897662443570n }],
    tags: ["Utility", "Chat"],

    start() {
        addChatBarButton("downloadThread", DownloadButtonRender, DownloadIcon);
    },

    stop() {
        removeChatBarButton("downloadThread");
    }
});
