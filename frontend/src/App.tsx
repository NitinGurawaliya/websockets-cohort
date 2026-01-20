
import { useEffect, useState } from 'react'
import './App.css'

function App() {
  const [socket,setSocket ] = useState();
  const[input,setInput] = useState("")


  function sendMessage(){
    if(!socket){
      return;
    }
    //@ts-ignore
    socket.send(input)
  }

  useEffect(()=>{
    const ws = new WebSocket("ws://localhost:3000")

    setSocket(ws)
    

    ws.onmessage = (ev)=>{
      alert(ev.data)
    }

  },[])

  return (
    <>
    <input type='text' onChange={(e)=>{
      setInput(e.target.value)
    }}  placeholder='type msg here' />
    <button 
      onClick={sendMessage}>send message</button>
    </>
  )
}

export default App
