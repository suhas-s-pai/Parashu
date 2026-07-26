import { useState } from "react";
import Login from "./Login";
import { Routes, Route } from "react-router-dom";
import Dashboard from "./Dashboard";
import Home from "./Home";
import MapGrid from "./MapGrid";
import Insights from "./Insights";
import Reports from "./Reports";
import Settings from "./Settings";

export default function App() {

  const [user,setUser] = useState(
    JSON.parse(localStorage.getItem("user"))
  );

  // show login page first
  if(!user){
    return <Login setUser={setUser} />;
  }

  return (

    <Routes>

      <Route path="/" element={<Home user={user} />} />

      <Route path="/dashboard" element={<Dashboard user={user} />} />

      <Route path="/alerts" element={<Dashboard user={user} focus="feed" />} />

      <Route path="/map" element={<MapGrid />} />

      <Route path="/insights" element={<Insights />} />

      <Route path="/reports" element={<Reports />} />

      <Route path="/settings" element={<Settings />} />

    </Routes>

  );

}
