import re
import os
import random
import json, time
from chatify.shared import key_string, iv, max_size, chatLogs, lobbyCount, online_users, logins, _SYSHASH, init, manager, ver, dprint
init()
lobby_manager = manager()
import chatify.common as common
import chatify.config as config
import chatify.security as secure
import chatify.data as data
import chatify.message as msg
import chatify.api as api
import chatify.generate_file_list as gfl
import art
import humanfriendly
import uvicorn
from fastapi.responses import HTMLResponse,  JSONResponse
from fastapi import FastAPI, Request, WebSocket
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import starlette.requests
from starlette.websockets import WebSocketState
import websockets # literally only here to make sure it is installed
api.lobby_manager = lobby_manager
secure.init(key_string, iv)
secure.lobby_manager = lobby_manager

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
limiter = Limiter(key_func=get_remote_address)

def render_template(file):
    with open(os.path.join("templates", file), "r", encoding="UTF-8") as m:
        c=m.read()
        return HTMLResponse(content=c)
    
def jsonify(data):
    return data #woooooooow


@app.get("/uploads/{username}", response_class=HTMLResponse)
async def list_user_files(username: str):
    return HTMLResponse(content=gfl.generate_html(os.path.join("static", "uploads", username)))

@app.middleware("http")
async def limit_upload_size(request: Request, call_next):
    received = 0
    original_receive = request.receive  # Save original receive method

    async def receive_with_limit():
        nonlocal received
        message = await original_receive()  # Call original, NOT request.receive()
        if message["type"] == "http.request":
            received += len(message.get("body", b""))
            if received > max_size:
                raise PayloadTooLarge()
        return message

    class PayloadTooLarge(Exception):
        pass

    try:
        request._receive = receive_with_limit
        return await call_next(request)
    except PayloadTooLarge:
        return JSONResponse({"detail": "Payload too large"}, status_code=413)
    
@app.api_route('/chat')
async def home():
    return render_template('chat.html')
@app.api_route('/login')
async def login():
    return render_template('login.html')

@app.api_route('/find')
async def find():
    return render_template('find.html')

@app.api_route('/settings')
async def settings():
    return render_template('settings.html')


@app.api_route('/profile')
async def profile():
    return render_template('profiles.html')

@app.api_route("/")
async def main():
    return render_template('chat.html') #someday..

connections = {}

async def broadcast(lobby, channel, message):
    global connections
    clients = connections.get((lobby, channel), [])
    clients = [c for c in clients if not c[0].client_state != WebSocketState.CONNECTED]
    connections[(lobby, channel)] = clients
    dprint(f"Broadcasting to {len(clients)} clients in lobby {lobby} channel {channel}")
    userlist = []
    for client in clients:
        user = client[1]
        userlist.append(user)
    for wsa in clients:
        ws = wsa[0]
        try:
            await ws.send_json({"type": "append_read", "content": message, "users" : userlist})
        except Exception as e:
            dprint(f"Error sending to client {ws}: {e}")
            
            



@app.websocket("/ws-connector")
async def websocket_endpoint(websocket: WebSocket):
    global connections
    await websocket.accept()
    lobby, channel, username = None, None, None
    try:
        while True:
            data = await websocket.receive_text()
            if lobby is not None and channel is not None:
                lobby_obj = lobby_manager.get_lobby(lobby)
                if lobby_obj:
                    logs = lobby_obj.channels[channel].logs
            dprint("Client sent:", data)
            js = json.loads(data)
            tp, params = js.get("type"), js.get("content", {})
            dprint(tp)
            if tp == "params":
                if lobby != int(params.get("lobby", -1)) or channel != int(params.get("channel", -1)):
                    if lobby is not None and channel is not None:
                        if (lobby, channel) in connections:
                            connections[(lobby, channel)].remove((websocket, username))
                            print(f"Removed websocket from lobby {lobby}, channel {channel}")
                lobby = int(params.get("lobby"))
                channel = int(params.get("channel"))
                username = secure.tokenize_user(token=params.get("token"))["name"]
                dprint(username)
                dprint("WebSocket connected to lobby:", lobby, "channel:", channel)
                key=(lobby, channel)
                if key not in connections:
                    connections[key] = []
                connections[key].append((websocket, username))
            elif tp == "read":
                if js["full"] == 'true':
                    dprint("Reading messages for lobby:", lobby, "channel:", channel)
                    await websocket.send_json({"type": "read", "content": logs})
                else:
                    dprint("Sending last message:", lobby, "channel:", channel)
                    await websocket.send_json({"type": "read", "content": logs[-1]})
            elif tp == 'send':
                dprint(params)
                data = params
                if data:
                    await send(None, data)

    except Exception as e:
        if lobby is not None and channel is not None:
            if (lobby, channel) in connections:
                connections[(lobby, channel)].remove((websocket, username))
                dprint(f"Removed websocket from lobby {lobby}, channel {channel} due to error: {e}")

@app.api_route("/get-users", methods=["GET"])
async def getUsers(request: Request):
    k = request
    lobby = int(k.headers.get("lobby"))
    tk = secure.check_token(k.headers.get("token"), k.headers.get("lobby"))
    dprint(lobby, tk, k.headers.get("token"))
    if tk:
        table = {
            "users" : lobby_manager.get_lobby(lobby).users,
            "admins" : lobby_manager.get_lobby(lobby).admins
        }
        return jsonify(table)
    return "nah"

@app.api_route("/create-lobby", methods=["POST"])
async def create_lobby(request: Request):
    global chatLogs, logins
    req = await request.json()
    lobbyName = req.get("name", "New Lobby")
    lobbyMode = req.get("mode", common.modes.public)
    lobbyPassword = req.get("password", "")
    req["user"] = secure.check_token(req["token"])
    if not lobbyName:
        return JSONResponse(content={"error": "Lobby name is required"}, status_code=400)

    new_lobby=common.Lobby()
    new_lobby.name = lobbyName
    new_lobby.mode = lobbyMode
    new_lobby.password = lobbyPassword
    new_lobby.real = True
    new_lobby.add_user(req["user"])
    new_lobby.admins.append(req["user"])
    id = lobby_manager.create_lobby(new_lobby)
    return jsonify({"status": "success", "lobby_id": id}), 200

@app.api_route("/create-channel", methods=["POST"])
async def create_channel(request: Request):
    global chatLogs, logins
    req = await request.json()
    lobbyID = int(req["lobby"])
    token = secure.check_token(req["token"], lobbyID)
    is_admin = api.is_admin(token, lobbyID)
    if not token or not is_admin:
        return JSONResponse(content={"error": "Unauthorized"},status_code=401)

    channelName = req.get("name", "New Channel")
    if not channelName:
        return JSONResponse(content={"error": "Channel name is required"},status_code= 400)

    lobby = lobby_manager.get_lobby(lobbyID)
    if not lobby:
        return JSONResponse(content={"error": "Lobby not found"}, status_code=404)

    new_channel = common.Channel(channelName)
    lobby.channels.append(new_channel)
    lobby_manager.return_lobby(lobbyID, lobby)

    return jsonify({"status": "success", "channel": new_channel.get_json()}), 200

@app.api_route("/server-metadata", methods=["GET"])
async def metadata():
    return jsonify({
        "lobby_count" : lobbyCount,
        "version" : ver,
        "encryption" : True
    })


@app.api_route("/change-lobby-settings", methods=["POST"])
async def changeSettings(request: Request):
    global chatLogs, logins
    req = request
    lobby_id = int(req.headers.get("lobby"))

    chat_log = lobby_manager.get_lobby(lobby_id)
    js = chat_log.get_json()
    settings = await request.json()

    if settings == {}:
        return jsonify(lobby_manager.get_lobby_config(lobby_id)), 200
    token = secure.check_token(req.headers.get("token"), int(req.headers.get("lobby")))
    if not token or not api.is_admin(token, req.headers.get("lobby")):
        return JSONResponse(content={"error": "Unauthorized"}, status_code=401)


    for key, val in settings.items():
        dprint(key, val)
        if key in lobby_manager.get_lobby_config(lobby_id):
            if key == "users":
                val = api.repair(val, chat_log)
            js["config"][key] = val

        if key == "password":
            chat_log.password = val

        if key == "name":
            chat_log.name = val
        


    chat_log.load_json(json.dumps(js))
    lobby_manager.return_lobby(lobby_id, chat_log)
    return jsonify(lobby_manager.get_lobby_config(lobby_id)), 200


@app.api_route("/get-lobby-info", methods=["GET"])
async def lobby_info(request: Request):
    global lobby_manager
    limit = int(request.headers.get("limit", 1))
    start = int(request.headers.get("start", 0))
    lobby_id = int(request.headers.get("lobby", -1))
    #dprint("limit", limit, "start", start, "id", lobby_id)
    if lobby_id < 0:
        result = {}
        for i in range(start, start + limit):
            result[i] = lobby_manager.get_lobby_config(i)
        return jsonify(result)
    else:
        return jsonify(lobby_manager.get_lobby_config(lobby_id))


@app.api_route("/get-channel-info", methods=["GET"])
async def getChannelInfo(request: Request):
    selectedChannel = int(request.headers.get("channel"))
    lobby=int(request.headers.get("lobby"))
    lobbies = {}
    if selectedChannel == -1:
        for i, chan in enumerate(lobby_manager.get_lobby(lobby).channels):
            j = chan.get_json()
            j['logs']= ''
            lobbies[str(i)] = j
        return jsonify(lobbies)
    else:
        try:
            j =  lobby_manager.get_lobby(lobby).channels[selectedChannel].get_json()
            
            j["logs"]=""
            return jsonify(j)
        except Exception as e:
            return jsonify({})
        
@app.api_route("/get-lobby-name", methods=["GET"])
async def getLobbyName(request: Request):
    selectedLobby = int(request.headers.get("lobby"))
    return jsonify(api.get_lobby(selectedLobby))
        
         
@app.api_route("/login-api", methods=['POST'])
@limiter.limit("0.25/second")
async def login_api(request: Request):
    global logins
    userItem = await request.json()
    loginInfo = secure.process_login(userItem["username"], userItem["password"])
    if loginInfo["status"] == "success":
        newPass = logins[userItem["username"]]["token"]
        return jsonify({'status': 'success', 'cookie': newPass})
    elif loginInfo["status"] == "created":
        newPass = logins[userItem["username"]]["token"]
        return jsonify({'status': 'created', 'cookie': newPass})
    elif loginInfo["status"] == "failed":
        return JSONResponse(content={'status': 'failed', 'message': 'Invalid username or password'}, status_code=401)
    data.save_messages(fancy=True, lobby=-1)


@app.api_route("/token-to-user", methods=["GET"])
async def tokenize(request: Request):
    token = request.headers.get("token")
    username = request.headers.get("username")
    dprint(logins)
    result = secure.tokenize_user(token=token)
    if result:
        return jsonify(result)
    return JSONResponse(content={"error": "User not found"}, status_code=404)

@app.api_route("/apply", methods=["POST"])
async def apply(request: Request):
    try:
        lobby_id = int(request.headers.get("lobby", -1))
    except (TypeError, ValueError):
        return JSONResponse(content={"error": "Invalid lobby ID"}, status_code=400)

    lobby = lobby_manager.get_lobby(lobby_id)
    user = secure.check_token(request.headers.get("token"))
    if not lobby or not user:
        return JSONResponse(content={"error": "Unauthorized"}, status_code=401)

    if config.configuration["OTHER"]["debug"]:
        if api.is_admin(user, -1):
            dprint("Admin allowed in lobby", lobby_id)
            return jsonify({"message" : "Already in lobby"})
    password = request.headers.get("password", random.randint(99,999999))
    if lobby.is_user(user):
        return jsonify({"message": "Already in lobby"})
    
    # If private lobby, check password
    if lobby.mode == common.modes.private:
        if password != lobby.password and (lobby.password != ""):
            return JSONResponse(content={"error": "Invalid password"}, status_code=405)

    # If user already in lobby, just return success

    # Add user
    lobby.add_user(user)
    return jsonify({"message": "Joined lobby"}), 200


@app.api_route("/change-profile-photo", methods=["POST"])
async def change_pfp(request: Request):
    info = await request.json()
    username = secure.check_token(request.headers.get("token"))
    dprint(username)
    if username:
        logins[username]["profile_photo"] = data.resizeb64(info["pfp"][1], size=(64, 64))
        return jsonify({})
    return JSONResponse(content={}, status_code=200)

@app.get("/search")
async def search(request: Request):
    query = request.headers.get("query", "").lower()
    if not query:
        return JSONResponse(content={"error": "Query header is required"}, status_code=400)
    
    results = []
    for lobby_id, metadata in lobby_manager.lobby_metadata.items():
        if query.lower() == metadata.get("name", "").lower():
            results.insert(metadata, 0)
            continue
        if query in metadata.get('name', '').lower():
            results.append(metadata)
            continue
    return jsonify(results)


@app.api_route('/send', methods=['POST'])
async def send(request: Request=None, datarr=None):
    global chatLogs, logins, lobby_manager
    if request or datarr is not None:
        if request is not None:
            info = await request.json()
        else:
            info = datarr
        dprint(info)
        lobbyID = int(info["lobby"])
        channel  = int(info['channel'])
        reply = info.get("reply", "")
        token = secure.check_token(info["code"],lobbyID) or (info["code"] == _SYSHASH)
        if not info.get("code") == _SYSHASH:
            info["user"] = token
        else:
            pass
        if not token:
            return JSONResponse(content={}, status_code=405)
        
        lbIn = lobby_manager.get_lobby(lobbyID)
        setts = lbIn.channels[channel]
        if setts.type == common.modes.silent and not api.is_admin(token, info["lobby"]):
            return JSONResponse(content={}, status_code=405)
        if reply != "" and reply != None:
            info["reply"] = api.get_message(lobbyID, channel, int(info["reply"]))
        conf = await metadata()
        if not conf.get("encryption", False):
            message = secure.decrypt(info["message"])
        else:
            message = info["message"]
        info["message"] = message
        enc = conf.get("encryption", False)
        #info["reply"] = api.get_message(lobbyID, channel, len(lbIn.channels[channel].logs)-1)
        #info["reactions"]=["😀", "😢", "😡", "👍", "👎"]
        if message == None:
            return JSONResponse(content={}, status_code=405)
        username = token
        users = info.get("allowed_users", [])

        if info["tp"] == "video":
            fileName = str(random.randint(10000000, 999999999)) + ".mp4"
            path = data.saveb64(message, fileName, token)
            info["message"] = path
            api.set_lobby(lobbyID, info,enc)
            return jsonify({'status': 'ok', 'received': message})

        if info["tp"] == "image":
            rz = data.resizeb64(info["message"])
            info["message"] = rz
            api.set_lobby(lobbyID, info, enc)
            return jsonify({'status': 'ok', 'received': message})

        if info["tp"] == "data":
            #dprint(info)
            path = data.saveb64(message, info["file"], token)
            info["file"] = path
            info["message"] = info["message"].split(",")[0]
            api.set_lobby(lobbyID, info, enc)
            await broadcast(lobbyID, channel, info)
            return jsonify({'status': 'ok', 'received': message})
        
        if str(message.strip()) != "":
            info["message"] = msg.format_message(message)

            #colors
            #info["message"] = msg.apply_text_coloring(info["message"])
            api.set_lobby(lobbyID, info, enc)
            await broadcast(lobbyID, channel, info)
            return jsonify({'status': 'ok', 'received': message})
        return jsonify({'status': 'ok', 'received': message})



msgcount = 0
@app.api_route("/messages", methods=["GET", "POST"])
async def message(request: Request):
    global chatLogs, online_users, msgcount
    msgcount += 1
    if request.method=="GET": #not legacy
        datar = request.headers
    else:
        datar = await request.json()
    if datar.get("channel") == "NaN":
        return JSONResponse(content={}, status_code=405)
    compat = int(datar.get("channel", -1))
    token = datar.get("code")#loadedData["code"]
    lobby = int(datar.get("lobby", 0))
    lobbyObject =lobby_manager.get_lobby(lobby)
    user = secure.check_token(token, lobby)
    if lobbyObject.mode == common.modes.private or not user:
        if not user:
            return JSONResponse(content={}, status_code=405)
    return jsonify(lobbyObject.channels[compat].logs)

    

import threading
import time
def background_save_loop(interval=3):
    global logins
    while True:
        time.sleep(interval)
        with open("logins.json", "w") as m:
            json.dump(logins, m)
        #data.save_messages()



def start_background_saver():
    thread = threading.Thread(target=background_save_loop, daemon=True)
    thread.start()
    return thread
thread = threading.Thread(target=lobby_manager.tick, daemon=True)
thread.start()
saver_thread = start_background_saver()
if __name__ == '__main__':
    lobby_manager=manager()
    data.lobby_manager = lobby_manager
    secure.lobby_manager = lobby_manager
    data.generateRequired()
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    data.load_messages()
    data.save_messages(False,-1)
    config.init()
    if not "System" in logins.keys():
        logins["System"] = {"token":_SYSHASH,  "admin":True, "profile_photo": "/static/default.jpg",}
        data.save_messages(True, -1)
    art.tprint(f"TSOC\n{ver}")
    debug_mode = config.debug
    if os.path.exists("logins.json"):
        with open("logins.json", "r") as m:
            loaded = json.load(m)
            logins.clear()
            logins.update(loaded)

    uvicorn.run("serve:app", host="0.0.0.0", port=5000, reload=True, )

