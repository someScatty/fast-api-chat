const button = document.getElementById("sendButton");
const textBox = document.getElementById("messageBox");
const messageList = document.getElementById("messageList");
const lobbyLabel = document.getElementById("titled");
const opener = document.getElementById("upload");
const file = document.getElementById("fileInput");
const photo = document.getElementById("photophoto");
const notif = new Audio('static/notif.wav');
const msginput = document.getElementById("msginput");
const create_channel = document.getElementById("channel-button");
const header = document.querySelector('.header');
const sidebar = document.querySelector('.sidebar');
const lobbySearcher = document.querySelector('.lobby-searcher');
const hdim = document.getElementById("hdim");
const root = document.documentElement;
const ls = document.getElementById("yay");
const pfp = document.getElementById("pfp");
const publi = document.getElementById("public");
const icon = document.getElementById("icon");
const settingsIcon = document.getElementById("lobbysettings");
const usernameText = document.getElementById("usernameText");
let max = 10;
let msgList = null;
let currentChannelId = null; // Track the current channel
let chattable;
let replyID = -1;
let replyMessage = {};
let doScroll = true;
let hasNotification = false;
let keys = [];
let lobbytitle = "";
let count = -1;
let lockUI = true;


let lobbyState = null;
let userState = structuredClone(UserBase);
//Event Listeners
textBox.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
        event.preventDefault();
        send();

    }
})
document.getElementById("profile-info").addEventListener("click", async function () {
    const file = await filePicker("image/*");
    if (file) {
        uploadProfilePhoto(file.contents);
        document.getElementById("photophoto").src = file.contents;
    }
})
opener.addEventListener("click", async () => {
    const file = await filePicker();
    if (file) {
        let base64 = file.contents;
        sendMessage(base64, "data", file.name);
        return;
    }
});
//WHY??
root.style.setProperty('--finder-width', '250px');
root.style.setProperty('--sidebar-width', '250px');
document.addEventListener('mouseclick', (e) => {
    const headerRect = hdim.getBoundingClientRect();
    const sidebarRect = sidebar.getBoundingClientRect();
    const lobbyRect = lobbySearcher.getBoundingClientRect();

    const viewportWidth = window.innerWidth;
    const rightEdgeThreshold = 100;
    const leftEdgeThreshold = 100;
    const minYThreshold = 300; // Mouse must be above this height to trigger lobby-searcher and sidebar expansion


    // Sidebar (left) expansion logic
    const sidebarExpanded = (e.clientX <= leftEdgeThreshold && e.clientY <= window.innerHeight && e.clientY <= minYThreshold) || lockUI;

    if (sidebarExpanded) {
        root.style.setProperty('--sidebar-width', '250px');
        sidebar.style.transform = 'translateX(0)';
        sidebar.style.opacity = '1';
        sidebar.style.zIndex = "99999";
        // messageList.style.transform = 'translateX(-135px)';
    }
    else {
        root.style.setProperty('--sidebar-width', '15px');
        sidebar.style.transform = 'translateX(-135px)'; // 150 - 15
        sidebar.style.opacity = '0.3';
        // sidebar.style.zIndex = "0";
        messageList.style.transform = 'translateX(0)';
    }

    // Lobby-searcher (right) expansion logic
    const isMouseInsideLobby = (
        e.clientX >= lobbyRect.left &&
        e.clientX <= lobbyRect.right &&
        e.clientY >= lobbyRect.top &&
        e.clientY <= lobbyRect.bottom
    );

    const lobbyExpanded = (
        (e.clientX >= viewportWidth - rightEdgeThreshold &&
            e.clientY <= window.innerHeight &&
            e.clientY <= minYThreshold) ||
        (isMouseInsideLobby && e.clientY <= minYThreshold)
    ) || lockUI;

    const collapsedOffset = 400 - 15; // assuming finder width 400px, collapsed width 15px

    if (lobbyExpanded) {
        root.style.setProperty('--finder-width', '250px');
        lobbySearcher.style.transform = 'translateX(0)';
        lobbySearcher.style.opacity = '1';
        lobbySearcher.style.zIndex = "99999";
    }
    else {
        root.style.setProperty('--finder-width', '15px');
        lobbySearcher.style.transform = `translateX(${collapsedOffset}px)`;
        lobbySearcher.style.opacity = '0.3';
        // lobbySearcher.style.zIndex = "0";
    }
    if (lockUI) {
        msginput.style.width = "64%";
        msginput.style.transform = 'translateX(8%)';
    }
});

//Functions
function scrollBottom() {
    requestAnimationFrame(() => {
        messageList.scrollTop = messageList.scrollHeight;
        document.scrollTop = 0;
    })
}
//Functions / Hellscape
async function handleCreateAndProcess() {
    await createChannel(lobby);
    processChannels();
}
async function send() {
    let content = textBox.value;
    textBox.value = "";
    if (replyID > 0) {
        await sendMessage(content, "text", "", replyID)
    }
    else {
        await sendMessage(content, "text")
    }
    await refresh()
}

function getUserColor(user) {
    if (!lobbyConfig || !lobbyConfig.users) { return "#000000" }
    Object.entries(lobbyConfig.users).forEach(([key, person]) => {
        if (person.name == user) {
            if (person.roles.length > 0) {
                let role = lobbyConfig.roles[person.roles[0]]
                return role.color;
            }
        }
    })
    return "#000000"
}

function renderFromDataURI(dataURI, filename, contents) {
    const mime = dataURI.substring(dataURI.indexOf(":") + 1, dataURI.indexOf(";"));
    let element;
    if (mime.startsWith("image/")) {
        element = document.createElement("img");
        element.src = contents;
    }
    else if (mime.startsWith("video/")) {
        element = document.createElement("video");
        element.src = contents;
        element.controls = true;
    }
    else if (mime.startsWith("audio/")) {
        element = document.createElement("audio");
        element.src = contents;
        element.controls = true;
    }
    else if (mime === "application/pdf") {
        element = document.createElement("iframe");
        element.src = contents;
        element.style.width = "100%";
        element.style.height = "400px";
    }
    else {
        element = document.createElement("a");
        element.href = contents;
        element.innerText = "Download " + filename;
        element.download = filename;
    }

    return element;
}


async function refresh(full = false, msgs = null, appendToTop = false) {
    let messages;
    if (full) {
        messageList.innerHTML = "";
        count = -1;
    }
    if (msgs == null) { return }
    else {
        messages = msgs;
    }

    console.log(messages)
    let users = []
    let high = false;
    let colored;
    for (let i = 1; i < messages.length; i++) {
        const current = messages[i];
        if (!users.includes(current.user)) users.push(current.user);
    }
    let draw_ui = true;
    Object.entries(messages).forEach(async ([key, value]) => {
        colored = null;
        high = false;
        value.message = decrypt(value.message);
        if ((key - count) > 0) {
            let colored = "#000000";
            for (let us of users) {
                
                const usernameLower = userState.username.toLowerCase();
                const usLower = us.toString().toLowerCase();


                const regex = new RegExp(`@${us.toString()}`, 'ig');

                const ping = "@" + usLower;
                const high = value.message.toLowerCase().includes(ping) && usLower === usernameLower;
                console.log("High: " + high + " User: " + usLower + " userState.username: " + usernameLower, "users", users, "ping", ping, "message", value.message.toLowerCase());

                if (high) {
                    value.message = value.message.replace(regex, (matched) => {
                        const userColor = getUserColor(us.toString());
                        return `<span class="mention" style="color: ${userColor}; background-color: rgba(0,0,0,0.1); padding: 2px 4px; border-radius: 4px;">${matched.toLowerCase()}</span>`;
                    });
                }
            }
            if (value.render === false) { return }
            let messageBoxed = document.createElement("div");
            if (key > 9999999999) {
                if (messages[key - 1].user == value.user && value.tp != "data" && messages[key - 1].tp != "data") {
                    messageList.lastChild.style.borderTop = "none";
                    messageBoxed = messageList.lastChild;
                    messageBoxed.style.paddingBottom = "5px";
                    const reactionDivs = messageBoxed.querySelectorAll('div.reactions');
                    reactionDivs.forEach(div => div.remove());
                    draw_ui = false;
                } else {
                    draw_ui = true;
                }
            }
            let messageItem = document.createElement("p");
            const holder = document.createElement("div");
            const usernameItem = document.createElement("p");
            const avatar = document.createElement("img");
            const reactions = document.createElement("div");

            let message = decrypt(value["message"]);
            messageBoxed.addEventListener('click', (event) => {
                replyID = Array.from(msgList).indexOf(value);
                replyMessage = value
            })

            messageBoxed.style.backgroundColor = high ? "#faf0ca" : "whitesmoke";
            messageBoxed.classList.add("messageObj");
            reactions.style.height = "fit-content"
            reactions.style.display = "inline-flex"
            reactions.style.width = "fit-content";
            reactions.style.justifyContent = "flex-end";
            reactions.style.alignItems = "center"
            reactions.style.flexDirection = "row";
            reactions.style.backgroundColor = "whitesmoke"
            reactions.style.alignSelf = "flex-end"
            reactions.style.borderRadius = "5px"
            reactions.className = "reactions";
            let reactionString = "";
            for (let reacted in value.reactions) {
                let react = value.reactions[reacted]
                let reactionHolder = document.createElement("div");
                reactionHolder.style.backgroundColor = "#E1E1E1"
                reactionHolder.style.width = "25px";
                reactionHolder.style.margin = "5px"
                reactionHolder.style.height = "25px"
                reactionHolder.style.display = "inline-flex"
                reactionHolder.style.justifyContent = "flex-start"
                reactionHolder.style.borderRadius = "4px"
                let re = document.createElement("p")
                re.style.fontSize = "18px"
                re.innerHTML = react;
                re.style.margin = "0px 0px"

                reactionHolder.appendChild(re);
                reactions.appendChild(reactionHolder)

            }

            holder.style.display = "flex"
            avatar.src = value["profile_photo"]
            avatar.style.height = "32px"
            avatar.style.width = "32px"
            avatar.style.alignSelf = "flex-end"
            avatar.style.padding = "2px 2px"
            avatar.style.borderRadius = "20px"
            photophoto.style.borderRadius = "20px"
            usernameItem.innerHTML = "<strong>" + value.user + "</strong>"
            usernameItem.style.fontSize = "17px"
            usernameItem.style.alignSelf = "flex-start"
            usernameItem.style.padding = "-20px 40px"
            usernameItem.style.margin = "4px 10px"
            if (colored) {
                usernameItem.style.color = colored;
            }
            count = parseInt(key);
            if (value.tp == "image") {
                messageItem.innerHTML = "<img src=%s></img>".replace("%s", message);
            }
            else if (value.tp == "video") {
                messageItem.innerHTML = "<video src=%s controls=true></video>".replace("%s", message);
            }
            else if (value.tp == "data") {
                messageItem = renderFromDataURI(message, value.file, value.file);
                //messageItem.innerHTML = "<a href=/static/uploads/%s /static/uploads/download=%s>%p</a>".replace("%s", value.file).replace("%p", value.file)

            }
            else if (value.tp == "text") {
                messageItem.innerHTML = message
            }
            if (value.reply) {
                if (value.reply.message) {
                    const holder = document.createElement("div")
                    const label = document.createElement("span")
                    const img = document.createElement("img")
                    if (decrypt(value.reply.message).startsWith("data:")) {
                        let filename = value.reply.file || "attachment";
                        msg = `<a href="${filename}" download="${filename}">${filename.split("/").pop()}</a>`;
                    }
                    else {
                        msg = decrypt(value.reply.message);
                    }
                    label.innerHTML = "%s: %m".replace("%s", value.reply.user).replace("%m", msg)
                    label.className = "reply-text"
                    img.className = "reply-img"
                    holder.className = "reply"
                    holder.style.backgroundColor = "#DDDDDD"
                    img.src = value.reply.profile_photo
                    holder.appendChild(img)
                    holder.appendChild(label)
                    messageBoxed.appendChild(holder)
                }
            }
            messageItem.style.margin = "1px"
            holder.appendChild(avatar);
            holder.appendChild(usernameItem);
            if (draw_ui) {
                messageBoxed.appendChild(holder);
            }
            messageBoxed.appendChild(messageItem);
            if (value.user == userState.username) {
                messageBoxed.classList.add("myMessages")
                photo.src = value.profile_photo;
            }
            messageList.appendChild(messageBoxed);
            if (draw_ui) {
                messageBoxed.appendChild(reactions);
            }
        }

    });

}

let p;


function main() {
    if (messageList.scrollHeight - messageList.scrollTop <= messageList.clientHeight + 25) {
        doScroll = true;
    }
    else {
        doScroll = false;
    }
    if (hasNotification) {
        icon.href = "/static/icon_notif.png?v=2"
    }
    else {
        icon.href = "/static/icon.png?v=2"
    }
    if (!document.hidden && hasNotification) {
        hasNotification = false;
    }
}
let lobbyConfig;

//Function to show the settings window
async function showSettingsWindow() {
    lobbyConfig = await getLobbyInfo(lobby);


    //check if we are NOT admin in this lobby
    if (!userState.lobby_admin) {
        //we'll fix this later, but for now just alert
        alert("You are not an admin!");
        settingsIcon.style.display = "none";
        return;
    }

    //Okay, so we are admin, *now* we can show it
    const settingsContainer = document.getElementById("settings-container");
    if (settingsContainer) {
        settingsContainer.style.display = "flex";
    } 
};

async function start() {
    lobbyState = await getLobbyObject();
    userState = await getUserObject();
    chattable = lobbyState.misc.is_chattable;
    //setting up global shit
    if (userState.lobby_admin) {create_channel.style.display = "block"; settingsIcon.style.display = "flex";}
    else{create_channel.style.display = "none"; settingsIcon.style.display = "none";}
    code = await auth();
    if (code != 200) {
        let pass;
        let statusCode = code;
        let attempts = 1;
        let max = 4;
        while (statusCode != 200) {
            pass = prompt("Please type in the password. (%s attempts remaining)".replace("%s", max - attempts));
            attempts++;
            statusCode = await auth(pass)
            if (max - attempts <= 0) {
                window.location.href = "/find"
            }
            if (statusCode != 200) {
                alert("Incorrect password.")
            }
        }
    }
    settingsIcon.addEventListener("click", showSettingsWindow);
    usernameText.innerText= `@${userState.username}`;
    //start other shit
    setInterval(main, 100);
    setInterval(looped, 1000, false);
    setInterval(processChannels, 5000);
    wss();
}

async function processChannels() {
    let lobbyConfig = await getLobbyInfo(lobby);
    lobbyLabel.innerHTML = lobbyConfig.name.toString().replace("%s", lobby);
    const ch = await getChannelInfo(lobby, -1);
    currentChannelId = parseInt(getCookie("channel")); // Get current channel from cookie or default to null
    const channelSelect = document.getElementById("channelList");
    channelSelect.innerHTML = ""; // Clear previous
    document.querySelector(".channels-name").textContent = lobbyConfig.name;
    let i = -1;
    Object.entries(ch).forEach(([key, value]) => {
        i++;
        const li = document.createElement("li");
        li.className = "channelItem";
        li.id = `channel-${key}`;
        li.textContent = value.name;
        // Highlight if this is the current channel
        if (i == currentChannelId) {
            li.classList.add("selected-channel");
        }

        li.addEventListener("click", async () => {
            currentChannelId = parseInt(key); // Update current channel
            setCookie("channel", currentChannelId);
            //chgchg(lobby)
            chattable = await isChattable();
            await connect();
            refresh(true, null)

            // Update active class
            document.querySelectorAll(".channelItem").forEach(el => el.classList.remove("selected-channel"));
            li.classList.add("selected-channel");

            refresh(true);
        });
        channelSelect.appendChild(li);
    });
}
processChannels();
const pfptext = document.getElementById("pfptext");

function chgchg(newchg) {
    changeLobby(lobby, newchg);
    refresh(true);
}


const replyButton = document.getElementById("stopReply");
replyButton.addEventListener("click", () => {
    replyID = -1;
    replyMessage = {};
});

function looped(loop) {
    lobby = changeLobby(-1);
    if (!chattable) {
        textBox.disabled = true;
        textBox.placeholder = "You do not have permission to speak in this channel."
        button.disabled = true;
        opener.disabled = true;

    }
    else {
        textBox.disabled = false;
        button.disabled = false;
        opener.disabled = false;

        if (replyID > 0) {
            replyButton.style.display = "inline-block";
            textBox.placeholder = "Replying to %s...".replace("%s", replyMessage.user)
        }
        else {
            replyButton.style.display = "none";
            textBox.placeholder = "Send a message..."
        }
    }

}
async function connect() {
    let params = {
        lobby: getCookie("lobby"),
        channel: getCookie("channel"),
        username: userState.username,
        token: getCookie("token")
    };
    await sendWSMessage({
        "type": "params",
        "content": params
    });
    await sendWSMessage({
        "type": "read",
        "full": 'true'
    });
}
async function wss() {
    msgList = null;
    await connectWebSocket(connect, null, function (data) {
        const info = JSON.parse(data);
        if (info.type == "read") {
            msgList = info.content;
            refresh(false, msgList);
            scrollBottom();
        }
        if (info.type == "append_read") {
            msgList.push(info.content);
            refresh(false, msgList);
            scrollBottom();
            if (document.hidden & !hasNotification) {
                hasNotification = document.hidden;
                notif.play();
            }

        }
    });

}


start();
