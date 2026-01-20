import {WebSocketServer} from "ws"

const ws = new WebSocketServer({port:3000})

ws.on("connection",function(socket){

        socket.on("message",(e)=>{
            if(e.toString()==="ping"){
                socket.send("pong")
            }
            else{
                socket.send("please send approporate messgae")
            }
         })

})