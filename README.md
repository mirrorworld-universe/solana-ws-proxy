# solana-ws-proxy
### Challenge of WebSocket for Solana RPC node.
Many wide-used methods rely on WebSocket, such as `onAccountChange` monitoring balance of accounts and `sendAndConfirmTransaction` confirming transactions. Solana RPC nodes have both IO and cpu heavy workload, as a result, new WebSocket connections may fail to establish connection with RPC nodes when RPC nodes are under heavy load or have already established a vast amount of WebSocket connections. However, Solana RPC nodes are typically expensive, sometimes it’s not cost-efficient to horizontal scale RPC nodes for supporting more WebSocket connections.  

### Why solana-ws-proxy
The solana-ws-proxy is a stateless transparent WebSocket middleware between clients and Solana RPC nodes. It’s designed to offload a portion of WebSocket workload from Solana RPC nodes to cost-efficient and high scalable services. With solana-ws-proxy middleware, solana RPC nodes can decline several orders of magnitude WebSocket connections from the number of client WebSocket connections to the number of ws-proxy instances. As a result, the RPC node overhead of maintaining millions of tpc socket connections can be mitigated and more client WebSocket connections could be supported.

### How solana-ws-proxy work
solana-ws-proxy service works as a transparent proxy middleware to forward all subscription event requests and responses between client and RPC node.  It merges clients WebSocket messages and forwards to a Solana RPC node with a unique tcp connection. It utilizes `id/result/subscriptionid` fields in Solana native WebSocket messages to match each client subscription event with RPC node response.   
A typical native solana WebSocket `onSignature` subscription used in `sendAndConfirmTransaction` is as follow, a client message will include `id` field which is a monotonically incremental counter in the client side to record each subscription.  
`{"jsonrpc":"2.0","method":"signatureSubscribe","params":["SIGNATURE",{"commitment":"confirmed"}],"id":1}`

Once receiving a client subscription, RPC node will firstly response a message with a `result` field  as a counter in RPC node side to match the client subscription message.  
`{"jsonrpc":"2.0","result":135609303,"id":1}`

After the subscribed event happens, the RPC node will response messages with a `subscription` field same as the value of `result` field in previous message.  
`{"jsonrpc":"2.0","method":"signatureNotification","params":{"result":{"context":{"slot":18557849},"value":{"err":null}},"subscription":135609303}}`

This method is for separating different subscription event request and response natively by Solana RPC node since WebSocket is data stream oriented protocal. The method also provides a simple way to map each request with corresponding response which is used in solana-ws-proxy.  
A solana-ws-proxy utilizes these `id`, `result`, `subscription` solana native WebSocket counters and maintains a monotonically incremental counter `proxy_id` locally. For a client request message, solana-ws-proxy replaces `id` with `proxy_id` value and forward to a RPC node. For a RPC response message, solana-ws-proxy replace `result`, `subscription` to `proxy_id` value and forward to the client. The previous example now could be as follow while `proxy_id` equals 42. 

```
client_data: {"jsonrpc":"2.0","method":"signatureSubscribe","params":["SIGNATURE",{"commitment":"confirmed"}],"id":1}
proxy_client_data: {"jsonrpc":"2.0","method":"signatureSubscribe","params":["SIGNATURE",{"commitment":"confirmed"}],"id":42}
server_data: {"jsonrpc":"2.0","result":135609303,"id":42}
proxy_server_data: {"jsonrpc":"2.0","result":42,"id":1}
server_data: {"jsonrpc":"2.0","method":"signatureNotification","params":{"result":{"context":{"slot":18557849},"value":{"err":null}},"subscription":135609303}}
proxy_server_data: {"jsonrpc":"2.0","method":"signatureNotification","params":{"result":{"context":{"slot":18557849},"value":{"err":null}},"subscription":42}}
```

Besides, solana-ws-proxy manages connections and heartbeats to mitigate such overhead of RPC nodes for orders of magnitude.

### Setup solana-ws-proxy
config the RPC provider network in `.env` file, then run
```
yarn
yarn start
```

### Connect solana-ws-proxy with @solana/web3.js 
For wallet: config the wss domain in ConnectionProvider.  
`<ConnectionProvider endpoint={YOUR_RPC_DOAMIN} config = {{commitment: 'confirmed', wsEndpoint:'ws://localhost:8080'}}>`  
For script: config the wss domain in Connection.  
`connection = new Connection(YOUR_RPC_DOAMIN, {commitment: 'confirmed', wsEndpoint:'ws://localhost:8080'});`  
After config wss domain, all the WebSocket methods such as `sendAndConfirmTransaction` will forward wss messages to ws-proxy.  
If you deploy solana-ws-proxy on cloud, you may config `wsEndpoint:'wss://YOUR_WSS_DOMAIN'`  
