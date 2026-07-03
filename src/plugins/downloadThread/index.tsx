import { addChatBarButton, ChatBarButton, ChatBarProps, removeChatBarButton } from "@api/ChatButtons";
import definePlugin from "@utils/types";
import { React, RestAPI, showToast, Toasts, Menu } from "@webpack/common";
import { zipSync, strToU8 } from "fflate";

function DownloadIcon(props: any) {
    return (
        <svg viewBox="0 0 24 24" width={props.width || 24} height={props.height || 24} className={props.className || "vc-download-thread-icon"} {...props}>
            <path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
        </svg>
    );
}

async function fetchAndFormatThread(threadChannel: any, zipData: Record<string, any>) {
    let allMessages: any[] = [];
    let lastId: string | null = null;

    while (true) {
        const query: any = { limit: 100 };
        if (lastId) query.before = lastId;

        const res = await RestAPI.get({
            url: `/channels/${threadChannel.id}/messages`,
            query
        });

        const msgs = res.body;
        if (!msgs || msgs.length === 0) break;

        allMessages = allMessages.concat(msgs);
        lastId = msgs[msgs.length - 1].id;

        if (msgs.length < 100) break;
        await new Promise(r => setTimeout(r, 250)); // Rate limit prevention
    }

    // Format messages in chronological order
    allMessages.reverse();
    let mdContent = `# ${threadChannel.name}\n\n`;

    const safeThreadName = threadChannel.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const threadDirName = `${safeThreadName}_${threadChannel.id}`;

    // Ensure the thread directory exists in zipData
    if (!zipData[threadDirName]) {
        zipData[threadDirName] = {};
    }

    for (const msg of allMessages) {
        const author = msg.author?.username || "Unknown";
        const content = msg.content;
        mdContent += `**${author}**:\n${content}\n`;

        if (msg.attachments && msg.attachments.length > 0) {
            for (const att of msg.attachments) {
                if (att.url) {
                    try {
                        const ext = att.filename.includes('.') ? att.filename.split('.').pop() : 'bin';
                        const name = att.filename.includes('.') ? att.filename.substring(0, att.filename.lastIndexOf('.')) : att.filename;
                        const safeName = `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${att.id}.${ext}`;

                        const res = await fetch(att.url);
                        const buf = await res.arrayBuffer();
                        if (!zipData[threadDirName]["images"]) {
                            zipData[threadDirName]["images"] = {};
                        }
                        zipData[threadDirName]["images"][safeName] = new Uint8Array(buf);

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

    zipData[threadDirName][`${safeThreadName}.md`] = strToU8(mdContent);
}

function DownloadButtonRender(props: ChatBarProps) {
    const [isDownloading, setIsDownloading] = React.useState(false);

    // Check if current channel is a thread (forum posts are also threads)
    if (!props.channel || !props.channel.isThread()) return null;
    const currentChannel = props.channel;

    const downloadThread = async () => {
        if (isDownloading) return;
        setIsDownloading(true);
        try {
            const zipData: Record<string, any> = {};
            await fetchAndFormatThread(currentChannel, zipData);
            
            const zipped = zipSync(zipData);
            const blob = new Blob([zipped], { type: "application/zip" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            const safeThreadName = currentChannel.name.replace(/[^a-zA-Z0-9_-]/g, '_');
            a.download = `${safeThreadName}_${currentChannel.id}.zip`;
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

let currentProgressText = "Starting...";
let setProgressText: ((text: string) => void) | null = null;

function ProgressToastContent() {
    const [text, setText] = React.useState(currentProgressText);
    React.useEffect(() => {
        setProgressText = setText;
        return () => { setProgressText = null; };
    }, []);

    React.useEffect(() => {
        if (text === "CLOSE_ME") {
            const el = document.getElementById("vc-mass-dl-toast");
            if (el) {
                const container = el.closest('[class*="toast_"]');
                if (container) {
                    (container as HTMLElement).style.display = "none";
                }
            }
        }
    }, [text]);

    return <span id="vc-mass-dl-toast">{text !== "CLOSE_ME" ? text : ""}</span>;
}

let isDownloadingForum = false;
async function downloadAllForumThreads(forumChannel: any) {
    if (isDownloadingForum) {
        showToast("Already downloading a forum!", Toasts.FAILURE);
        return;
    }
    isDownloadingForum = true;
    currentProgressText = "Fetching forum threads...";
    
    const toastData = Toasts.create((<ProgressToastContent />) as any, Toasts.Type.INFO, {
        duration: 9999999
    });
    Toasts.show(toastData);

    const updateProgress = (msg: string) => {
        currentProgressText = msg;
        if (setProgressText) setProgressText(msg);
    };

    updateProgress("Fetching forum threads...");
    
    try {
        let allThreads: any[] = [];
        
        // Fetch active threads
        try {
            const activeRes = await RestAPI.get({
                url: `/guilds/${forumChannel.guild_id}/threads/active`
            });
            if (activeRes.body?.threads) {
                const active = activeRes.body.threads.filter((t: any) => t.parent_id === forumChannel.id);
                allThreads = allThreads.concat(active);
            }
        } catch (e) {
            console.error("Failed to fetch active threads", e);
        }

        // Fetch archived threads (paginated)
        let hasMore = true;
        let before: string | undefined = undefined;
        while (hasMore) {
            try {
                const query: any = {};
                if (before) query.before = before;
                
                const archivedRes = await RestAPI.get({
                    url: `/channels/${forumChannel.id}/threads/archived/public`,
                    query
                });
                
                if (archivedRes.body?.threads?.length) {
                    allThreads = allThreads.concat(archivedRes.body.threads);
                    before = archivedRes.body.threads[archivedRes.body.threads.length - 1].thread_metadata.archive_timestamp;
                    hasMore = archivedRes.body.has_more;
                } else {
                    hasMore = false;
                }
                
                await new Promise(r => setTimeout(r, 250)); // rate limit prevention
            } catch (e) {
                console.error("Failed to fetch archived threads", e);
                hasMore = false;
            }
        }
        
        if (allThreads.length === 0) {
            updateProgress("CLOSE_ME");
            showToast("No threads found in this forum.", Toasts.FAILURE);
            isDownloadingForum = false;
            return;
        }

        const zipData: Record<string, any> = {};
        
        // Download each thread
        for (let i = 0; i < allThreads.length; i++) {
            const thread = allThreads[i];
            updateProgress(`Downloading thread ${i + 1}/${allThreads.length}: ${thread.name}...`);
            try {
                await fetchAndFormatThread(thread, zipData);
            } catch (e) {
                console.error(`Failed to download thread ${thread.name}`, e);
            }
            await new Promise(res => setTimeout(res, 500));
        }
        
        updateProgress("Zipping all threads...");
        const zipped = zipSync(zipData);
        const blob = new Blob([zipped], { type: "application/zip" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const safeForumName = forumChannel.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        a.download = `Forum_${safeForumName}_${forumChannel.id}.zip`;
        a.click();
        URL.revokeObjectURL(url);
        
        updateProgress("CLOSE_ME");
        showToast(`Successfully downloaded ${allThreads.length} threads!`, Toasts.SUCCESS);
    } catch (e) {
        console.error(e);
        updateProgress("CLOSE_ME");
        showToast("Failed to download forum threads.", Toasts.FAILURE);
    } finally {
        isDownloadingForum = false;
    }
}

export default definePlugin({
    name: "DownloadThread",
    description: "Adds a button to thread chat bar to download the entire thread as a clean markdown file. Also adds a context menu to Forum channels to download all threads.",
    authors: [{ name: "Saturn", id: 965286897662443570n }],
    tags: ["Utility", "Chat"],

    contextMenus: {
        "channel-context": (children, props) => {
            const channel = props.channel;
            // 15 is GUILD_FORUM type
            if (!channel || (!channel.isForumLikeChannel?.() && channel.type !== 15)) return;

            children.push(
                <Menu.MenuItem
                    id="vc-download-all-forum-threads"
                    label="Download All Threads"
                    action={() => downloadAllForumThreads(channel)}
                    icon={DownloadIcon}
                />
            );
        }
    },

    start() {
        addChatBarButton("downloadThread", DownloadButtonRender, DownloadIcon);
    },

    stop() {
        removeChatBarButton("downloadThread");
    }
});
