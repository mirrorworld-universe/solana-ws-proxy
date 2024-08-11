import { WebSocketServer, WebSocket as WebSocketClient } from 'ws';
require("dotenv").config();

const RPC_DOMAIN = process.env.SUBSCRIBE_DOMAIN;
const WS_PROXY_PORT = Number(process.env.WS_PROXY_PORT);

let ws_client_lock: boolean;
let global_proxy_id: number;
let proxy_client_connextions: Map<number, ProxyConnection>;
let server_proxy_subscriptions: Map<number, number>;
let ws_client: WebSocketClient;
let ws_server: WebSocketServer;

interface ProxyConnection {
    client: WebSocketClient,
    client_id: number,
    proxy_id: number,
    server_id: number
}

function startNewWsProxy() {
    createNewWsClient();
    createNewWsServer();
}

function createNewWsClient() {
    ws_client = new WebSocketClient(RPC_DOMAIN);
    ws_client_lock = false;
    global_proxy_id = 0;
    proxy_client_connextions = new Map();
    server_proxy_subscriptions = new Map();
    addListenersWsClient(ws_client);
}

function addListenersWsClient(client: WebSocketClient) {
    client.on('open', function open() {
        console.debug("connected to rpc websocket node");
        const heartbeatInterval = setInterval(() => {
            const heartbeatMessage = JSON.stringify({
              jsonrpc: '2.0',
              method: 'ping',
            });
            client.send(heartbeatMessage);
            console.debug('Heartbeat message sent');
          }, 5000);
        
        client.on('close', function close() {
            console.debug("client close");
            ws_client_lock = false;
            clearInterval(heartbeatInterval);
            setTimeout(startNewWsProxy, 500);
        });
    
        client.on('error', function error(err) {
            console.error("client error", err);
            ws_client_lock = false;
            clearInterval(heartbeatInterval);
            setTimeout(startNewWsProxy, 3000);
        });

        client.on('message', function message(server_data) {
            let proxy_id;
            console.debug('server_data %s', server_data.toString())
            const sever_data_json = JSON.parse(server_data.toString());
            if ("id" in sever_data_json && "result" in sever_data_json) {
                const server_subscription = sever_data_json.result;
                proxy_id = sever_data_json.id;    
                server_proxy_subscriptions.set(server_subscription, proxy_id);
                const proxy = proxy_client_connextions.get(proxy_id);
                proxy.server_id = server_subscription;
                // replace proxy_id with real client_id
                // replace server_id with proxy_id
                sever_data_json.id = proxy?.client_id;
                sever_data_json.result = proxy?.proxy_id;
                const proxy_data_str = JSON.stringify(sever_data_json);
                console.debug('proxy_server_data %s', proxy_data_str)
                proxy?.client.send(proxy_data_str);
            } else if ("method" in sever_data_json && "params" in sever_data_json) {
                const server_subscription = sever_data_json.params.subscription;
                proxy_id = server_proxy_subscriptions.get(server_subscription);
                if (proxy_id != undefined) {
                    const proxy = proxy_client_connextions.get(proxy_id);
                    // replace server_id with proxy_id
                    sever_data_json.params.subscription = proxy?.proxy_id;
                    const proxy_data_str = JSON.stringify(sever_data_json);
                    console.debug('proxy_server_data %s', proxy_data_str)
                    proxy?.client.send(proxy_data_str);
                }
            }
        });
    });
    ws_client_lock = true;
}

function createNewWsServer() {
    if (ws_server) {
        ws_server.close();
    }
    ws_server = new WebSocketServer({ port: WS_PROXY_PORT });
    ws_server.on('connection', function connection(ws) {
        const proxy_ids = new Set<number>();
        console.debug('New client connected');
        ws.on('message', function message(client_data) {
            console.debug('client_data: %s', client_data.toString());
            const client_data_json = JSON.parse(client_data.toString());
            if ("params" in client_data_json && "id" in client_data_json ) {
                global_proxy_id = global_proxy_id + 1;
                const cur_proxy_id = global_proxy_id;
                proxy_ids.add(cur_proxy_id);
                if (cur_proxy_id >= Number.MAX_SAFE_INTEGER) {
                    ws_client.close(); // onclose callback will reconnect to rpc node
                }
                const proxy_connection: ProxyConnection = {
                    client: ws,
                    client_id: 0,
                    proxy_id: 0,
                    server_id: 0,
                }
                proxy_connection.client_id = client_data_json["id"];
                proxy_connection.proxy_id = cur_proxy_id;
                proxy_client_connextions.set(cur_proxy_id, proxy_connection);
                // replace client_id with proxy_id
                client_data_json["id"] = cur_proxy_id;
                const proxy_data_str = JSON.stringify(client_data_json);
                console.debug('proxy_client_data %s', proxy_data_str)
                if (ws_client_lock) {
                    ws_client.send(proxy_data_str);
                }
            }
        });
        ws.on('close', function close() {
            cleanClientResources();
        });
        ws.on('error', function error(err) {
            console.error("client error", err);
            cleanClientResources();
        });
        function cleanClientResources() {
            console.debug('cleanClientResources proxy_ids: ', proxy_ids)
            for (let proxy_id of proxy_ids) {
                let proxy_connection: ProxyConnection = proxy_client_connextions.get(proxy_id);
                server_proxy_subscriptions.delete(proxy_connection.server_id)
                proxy_client_connextions.delete(proxy_id);
            }
        }
    });
}

startNewWsProxy();