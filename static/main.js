const keyString = "rVWxjr21gPj1XNBjvqoD2958huztj5orcIvpqQU3ZLxGSdY5t1"
const keyV = CryptoJS.SHA256(keyString);
const iv = CryptoJS.enc.Utf8.parse("3043369271225841");
const baseURL = ""

//constants
const LobbyBase = Object.freeze({
  id: null,
  name: "",
  mode: "",
  users: {},
  admins: [],
  stats: {
    user_count: 0,
    admin_count: 0,
    description: "N/A"
  },
  misc: {
    real: false,
    saves: true,
    is_chattable: true
  },
  channels: [],
  currentChannelID: 0,
  currentChannel: null
});

const UserBase = Object.freeze({
    username: "",
    profile_photo: "",
    token: null,
    roles: [],
    admin: false,
    lobby_admin: false,
})

let lobby = 0;
let username = "";
let channel = 0;
let server = "/";
let ws;
let conf;
let ws_connected = false;
let validToken = true;
async function connectWebSocket(connectedCallback = null, errorCallback = null, messageCallback = null) {
    ws = new WebSocket(`ws://${window.location.host}/ws-connector`);
    ws.onopen = () => {
        console.log("WebSocket connection established");
        ws_connected = true;
        if (connectedCallback) connectedCallback();
    };
    ws.onmessage = (event) => {
        //console.log("Message from server:", event.data);
        if (messageCallback) { messageCallback(event.data) };
    };
    ws.onclose = () => {
        console.log("WebSocket connection closed");
        if (errorCallback) { console.error("error"); errorCallback() };
        ws_connected = false;
    };
}

async function sendWSMessage(message) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !ws_connected) {
        console.log("Connecting to websocket..");
        //await connectWebSocket();
    }
    ws.send(JSON.stringify(message));
}

async function getServerConfig() {
    confee = await fetch("/server-metadata", {
        method: "GET"
    })
    conf = await confee.json()
    document.title = "TSOC " + conf.version;
    return conf;
}
async function createChannel() {
    const name = prompt("Channel name:", "New Channel");
    if (!name) return;
    const res = await fetch("/create-channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lobby: getCookie("lobby"), token: getCookie("token"), name: name })
    });
    const data = await res.json();
    if (res.ok) console.log("Created:", name);
    else console.error("Error:", data.error);
}


async function createLobby(name, mode, password, user) {
    const res = await fetch("/create-lobby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name, mode: mode, password: password, token: getCookie("token") })
    });
    const data = await res.json();
    return res.ok ? data.lobby_id : null;
}

function looksLikeEncrypted(str) {
    return /^[A-Za-z0-9+/=]+$/.test(str) &&
        str.length % 4 === 0 &&
        (CryptoJS.enc.Base64.parse(str).sigBytes % 16 === 0);
}


function encrypt(message, key = keyV) {
    if (conf == null) {
        conf = { encrypted: true }; // Default to encrypted if conf is not set
    }
    const encrypted = CryptoJS.AES.encrypt(message, key, {
        iv: iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
    });
    if (conf.encrypted) {
        return encrypted.ciphertext.toString(CryptoJS.enc.Base64);
    } else {
        return message
    }
}

async function searchLobbies(query) {
    const res = await fetch("/search", {
        method: "GET", // or POST if you prefer
        headers: {
            "query": query
        }
    });
    if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
    return await res.json();
}

function decrypt(base64Cipher, key = keyV) {
    if (conf == null) {
        conf = { encrypted: true }; // Default to encrypted if conf is not set
    }
    if (!looksLikeEncrypted(base64Cipher)) {
        return base64Cipher; // Return as is if not encrypted
    }
    const encryptedHex = CryptoJS.enc.Base64.parse(base64Cipher);
    const encrypted = CryptoJS.lib.CipherParams.create({
        ciphertext: encryptedHex
    });
    const decrypted = CryptoJS.AES.decrypt(encrypted, key, {
        iv: iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
    });
    if (!conf.encrypted) {
        return decrypted.toString(CryptoJS.enc.Utf8);
    } else {
        return base64Cipher
    }
}
function downloadFile(filename, content) {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}


async function saveLobby(download = false) {
    let lobby = getCookie("lobby");
    let data = {}
    let config = await getLobbyInfo();
    console.log(config)
    data["config"] = config
    let channels = await getChannelInfo();
    let newChannels = [];
    let i = 0;

    for (const key in channels) {
        let clone = { ...channels[key] }; // clone the actual channel object
        setCookie("channel", i);
        clone.logs = await readMessages(false);
        newChannels.push(clone);
        i++;
    }

    data["channels"] = newChannels;
    let finish = JSON.stringify(data, null, 2);
    if (download) {
        downloadFile("%s.json".replace("%s", lobby), finish)
    }
    return finish;
}

function getCookie(cookieName) {
    let cookies = document.cookie.split("; ");
    for (const cookie of cookies) {
        const [key, value] = cookie.split("=");
        if (key == cookieName) {
            return value;
        }
    }
    return null;
}

async function isChattable() {
    const channelInfo = await getChannelInfo();
    await getUsername();
    const channelData = channelInfo[getCookie("channel")];
    return channelData && channelData.type !== "silent";
}

function setCookie(cookieName, value, days = 365) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${encodeURIComponent(cookieName)}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
}


async function getUsers() {
    const header = { "token": validateToken(false), "lobby": getCookie("lobby") }
    const usernameRequest = await fetch(`/get-users`, { "method": "GET", "headers": header });
    const data = await usernameRequest.json()
    return data
}


async function updateLobbySettings(settings) {
    const header = { "token": validateToken(false), "lobby": getCookie("lobby") }
    const request = await fetch(`/change-lobby-settings`, { "method": "POST", "headers": header, "body": JSON.stringify(settings) });
    return await request.json();
}
async function sha256Hash(data) {
    return CryptoJS.SHA256(data).toString(CryptoJS.enc.Hex);
}

async function loginAPI(username, password) {
    hased = await sha256Hash(password);
    m = await fetch("/login-api", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ username: username, password: hased })
    })
    const response = await m.json();
    if (m.status == 200) {
        setCookie("token", response.cookie)
        return true
    } else {
        return false

    }
}


function validateToken(redirect = true) {
    let token = getCookie("token");
    if (!token) {
        return null;
    } else {
        if (!getCookie("token") || getCookie("token").length != 64) {
            return null;
        }
    }
    //if (redirect) {window.location.assign("/login");}
    return token;
}

async function getUsername(user = null) {
    let token = validateToken(true);
    if (user) {
        const header = { "username": user };
        const usernameRequest = await fetch(`/token-to-user`, { "method": "GET", "headers": header });
        const data = await usernameRequest.json()
        return data;
    } else if (token) {
        const header = { "token": token };
        const usernameRequest = await fetch(`/token-to-user`, { "method": "GET", "headers": header });
        const data = await usernameRequest.json()
        if (usernameRequest.status != 200) {
            return null;
        }
        return data;
    }
}

async function sendMessage(message, type, filename = "", replyID = NaN) {
    const lobbyI = parseInt(getCookie("lobby"));
    const timestamp = Math.floor(Date.now() / 1000);
    const token = validateToken(true);
    if (token) {
        const body = {
            message: encrypt(message),
            user: "", // Compatibility support
            time: timestamp,
            tp: type,
            file: filename,
            code: token,
            lobby: lobbyI,
            channel: parseInt(getCookie("channel")),
            reply: replyID
        };
        if (ws_connected) {
            sendWSMessage({ type: "send", content: body });
        } else {
            const request = await fetch(`/send`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            return await request.json();
        }
    } else {
        return 415;
    }
}


async function getLobbyName(lobby = getCookie("lobby")) { //helper function
    request = await fetch(`/get-lobby-info`, { "method": "GET", headers: { "lobby": lobby } })
    response = await request.json()
    return response.name;
}

async function getLobbyInfo(lobby = getCookie("lobby"), limit = 10, start = 0) { //helper function
    request = await fetch(`/get-lobby-info`, { "method": "GET", headers: { "lobby": lobby, "limit": start, "start": limit } })
    response = await request.json()
    if (response.code != 200) {
        setTimeout(() => { }, 4000)
    }
    return response;
}
async function getChannelInfo() { //helper function
    request = await fetch(`/get-channel-info`, { "method": "GET", headers: { "lobby": getCookie("lobby"), "channel": -1 } })
    response = await request.json()
    return response;
}
function changeLobby(newLobby, ch = parseInt(getCookie("channel"))) {
    const currentChannel = parseInt(getCookie("channel"));
    const currentLobby = parseInt(getCookie("lobby"));

    if (ch >= 0 && ch !== currentChannel) {
        setCookie("channel", ch);
    }

    if (newLobby < 0) {
        return currentLobby;
    }

    if (newLobby !== currentLobby) {
        setCookie("lobby", newLobby);
        setCookie("channel", 0);
    }

    return newLobby;
}


async function uploadProfilePhoto(imagedata) {
    let image = imagedata.split(",")[1];
    const m = await fetch('/change-profile-photo', {
        method: "POST",  // don't forget this!!
        headers: {
            "Content-Type": "application/json",
            "token": getCookie("token")
        },
        body: JSON.stringify({ pfp: [null, image] }) // assuming you're accessing [1] in backend
    });

    return await m.json(); // or handle however needed
}

function filePicker(accept = "") {
    return new Promise((resolve, reject) => {
        const filePicker = document.createElement("input");
        filePicker.type = "file";
        filePicker.accept = accept;
        filePicker.addEventListener("change", () => {
            const fileData = filePicker.files[0];
            const reader = new FileReader();
            reader.onload = () => {
                const fileInfo = {
                    name: fileData.name,
                    contents: reader.result,
                    size: fileData.size
                };
                resolve(fileInfo);  // Resolves the Promise with the file info
            };

            reader.onerror = (error) => {
                reject(error);  // Rejects the Promise if an error occurs
            };

            reader.readAsDataURL(fileData);
        });

        filePicker.click();
    });
}

async function readMessages(decrypted = true) {
    const token = validateToken(true);
    channel = parseInt(getCookie("channel"));
    const response = await fetch(`/messages`, {
        method: "GET",
        headers: { lobby: lobby, code: token, channel: channel }
    });
    const messages = await response.json();
    let messageTable = {};
    Object.entries(messages).forEach(([key, value]) => {
        // console.log(value.message)
        if (decrypted) {
            let dc = decrypt(value.message);
            if (dc != "") {
                value.message = dc
            }
        }
        messageTable[key] = value;
    });
    //console.log(messages)
    return messages;
}



async function auth(password = "") {
    const apply = await fetch("/apply", {
        method: "POST",
        headers: { lobby: parseInt(getCookie("lobby")), token: getCookie("token"), password: password }
    })
    return apply.status;
}

//Get a table which can be cached for the core lobby details; to update, call updateLobby instead
async function getLobbyObject() {
    const info = await getLobbyInfo();
    const channels = await getChannelInfo();
    const chattable = await isChattable();
    let state = structuredClone(LobbyBase);

    //core fields
    state.name = info.name;
    state.id = parseInt(getCookie("lobby")); //i know.
    state.users = info.users;
    state.admins = info.admins;
    state.mode = info.mode;

    //other shit
    state.channels = channels;
    state.currentChannelID = parseInt(getCookie("channel"));
    state.currentChannel = channels[state.currentChannelID]

    //stats
    state.stats.admin_count = info.admin_count;
    state.stats.user_count = info.user_count;
    state.stats.description = info.description;

    state.misc.real = info.real;
    state.misc.saves = info.save;
    state.misc.is_chattable = chattable;
    return state;
}

//Gets a user object. You don't need to update this that often, once a reload is prob okay
async function getUserObject() {
    const stats = await getUsername();
    const lobbyInfo = await getLobbyInfo(); //for admin checks
    let newUser = structuredClone(UserBase);
    newUser.username = stats.name;
    newUser.admin = stats.admin;
    newUser.lobby_admin = (lobbyInfo.admins.includes(stats.name)) //amazing i know
    newUser.profile_photo = stats.profile_photo;
    newUser.token = stats.token;

    return newUser;
}

function setDefaultCookies() {
    if (!getCookie("lobby")) {
        setCookie("lobby", 0);
    }

    if (!getCookie("channel")) {
        setCookie("channel", 0);
    }

    if (!getCookie("theme1") && !getCookie("theme2")) {
        setCookie("theme1", "#ff8900");
        setCookie("theme2", "#ffaa00");
    }
    if (!getCookie("lobby")) {
        setCookie("lobby", "0");
    }

    if (!getCookie("channel")) {
        setCookie("channel", "0");
    }
    const root = document.documentElement;
    root.style.setProperty("--primary-color", decodeURIComponent(getCookie("theme1")))
    root.style.setProperty("--second-color", decodeURIComponent(getCookie("theme2")))

}
setDefaultCookies();
getServerConfig();
setInterval(getServerConfig, 30000);