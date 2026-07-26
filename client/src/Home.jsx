import { useState, useRef } from "react";
import axios from "axios";
import {
  ShieldAlert,
  Mic,
  MicOff,
  MapPin,
  ExternalLink,
  LogOut,
  Phone,
  PhoneCall,
  Flame,
  Ambulance,
  Users,
  Square,
  Navigation,
  LayoutDashboard,
} from "lucide-react";

// Official Indian emergency numbers. These dial for real.
const CONTACTS = [
  { icon: PhoneCall, label: "Police / Emergency", note: "National emergency number", number: "112" },
  { icon: Ambulance, label: "Ambulance", note: "Medical emergency", number: "108" },
  { icon: Flame, label: "Fire", note: "Fire and rescue", number: "101" },
  { icon: Users, label: "Women Helpline", note: "24x7 support", number: "1091" },
];

export default function Home() {

 const user = JSON.parse(localStorage.getItem("user"))
const [status,setStatus] = useState("Ready");
const [listening,setListening] = useState(false);
const [mapLink,setMapLink] = useState("");
const recognitionRef = useRef(null);
const trackingRef = useRef(null);
const statusCheckRef = useRef(null);
const sosActiveRef = useRef(false);

 const startListening = () => {

const SpeechRecognition =
window.SpeechRecognition || window.webkitSpeechRecognition;

if(!SpeechRecognition){
alert("Speech recognition not supported");
return;
}

const recognition = new SpeechRecognition();

recognition.continuous = true;
recognition.interimResults = false;

recognitionRef.current = recognition;

setListening(true);
setStatus("Voice protection active");

recognition.onresult = (event)=>{

const speech =
event.results[event.results.length-1][0].transcript.toLowerCase();

if(speech.includes("help me") || speech.includes("sos")){
triggerSOS();
}

};

recognition.onend = () => {
  if (recognitionRef.current) {
    recognitionRef.current.start();
  }
};

recognition.start();

};


  const stopListening = () => {

setListening(false);

if(recognitionRef.current){
recognitionRef.current.stop();
}

setStatus("Voice protection stopped");

};


   const triggerSOS = () => {

    if(sosActiveRef.current) return;
    sosActiveRef.current = true;

    setStatus("Getting location...");

    navigator.geolocation.getCurrentPosition(async(pos)=>{

      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      const mapURL = `https://maps.google.com/?q=${lat},${lon}`;
      setMapLink(mapURL);

      try{

        await axios.post("https://kalisos-backend.onrender.com/sos",{
         user_name:user.name,
         phone:user.phone,
         latitude:lat,
         longitude:lon
        });

        setStatus("🚨 SOS Alert Sent");
        startLiveTracking();
        checkIfHandled();




      }catch{
        setStatus("Error sending alert");
      }

    });

  };


  const startLiveTracking = () => {

trackingRef.current = setInterval(()=>{

navigator.geolocation.getCurrentPosition(async(pos)=>{

const lat = pos.coords.latitude;
const lon = pos.coords.longitude;

try{

await axios.post("https://kalisos-backend.onrender.com/sos",{
user_name:user.name,
phone:user.phone,
latitude:lat,
longitude:lon
});

}catch(err){
console.log("Tracking error");
}

});

},5000);

};


const checkIfHandled = () => {

statusCheckRef.current = setInterval(async()=>{

try{

const res = await axios.get(`https://kalisos-backend.onrender.com/alert-status/${user.phone}`);
if(res.data.status === "handled"){

clearInterval(trackingRef.current);
clearInterval(statusCheckRef.current);

sosActiveRef.current = false;

setStatus("Emergency handled by authorities");

}

}catch(err){
console.log("Status check failed");
}

},3000);

};

  // Stops the location upload loop without touching the alert already filed.
  // Mirrors exactly what checkIfHandled does when authorities close the case.
  const stopTracking = () => {
    clearInterval(trackingRef.current);
    clearInterval(statusCheckRef.current);
    sosActiveRef.current = false;
    setStatus("Tracking stopped");
  };

  /* ---------- derived display state (no new state variables) ---------- */

  const sent = status.includes("SOS Alert Sent");
  const sending = status.includes("Getting location");
  const handled = status.includes("handled");
  const failed = status.includes("Error");
  const tracking = sent && !handled;

  const emergency = handled
    ? { text: "Help On The Way", dot: "ks-dot--green" }
    : failed
    ? { text: "Send Failed", dot: "ks-dot--red" }
    : sent
    ? { text: "Alert Sent", dot: "ks-dot--red" }
    : sending
    ? { text: "Sending Alert", dot: "ks-dot--amber" }
    : { text: "Idle", dot: "" };

  const voice = sent
    ? { text: "SOS Activated", dot: "ks-dot--red" }
    : listening
    ? { text: "Listening", dot: "ks-dot--green" }
    : { text: "Not Listening", dot: "" };

  const gps = mapLink
    ? { text: "Location Found", dot: "ks-dot--green" }
    : { text: "Not Available", dot: "" };

  return (

  <div className="ks-home">

    <div className="ks-home__particles" aria-hidden="true">
      <i /><i /><i /><i /><i /><i />
    </div>

    <header className="ks-home__nav">

      <a className="ks-logo" href="/" style={{ marginBottom: 0, height: "auto" }}>
        <span className="ks-logo__mark"><ShieldAlert size={16} strokeWidth={2.1} /></span>
        <span className="ks-logo__text">Kali<span>SOS</span></span>
      </a>

      <div style={{ flex: 1 }} />

      <a className="ks-btn ks-btn--ghost ks-btn--sm" href="/dashboard" title="Control room">
        <LayoutDashboard size={14} strokeWidth={1.9} />
      </a>

      <div className="ks-badge-police" title={user?.phone}>
        <span className="ks-avatar ks-avatar--sm ks-avatar--neutral">
          {String(user?.name || "?").trim().charAt(0).toUpperCase()}
        </span>
        <span className="ks-badge-police__id">
          <strong>{user?.name}</strong>
          <span>{user?.phone}</span>
        </span>
      </div>

      <button
        className="ks-btn ks-btn--ghost ks-btn--sm"
        onClick={() => {
          localStorage.removeItem("user");
          window.location.reload();
        }}
        title="Logout"
      >
        <LogOut size={14} strokeWidth={1.9} />
      </button>

    </header>

    <main className="ks-home__main">

      <button className="ks-sos" onClick={triggerSOS}>
        SOS
        <small>Send emergency alert</small>
      </button>

      <button
        className={`ks-voice ${listening ? "is-on" : ""}`}
        onClick={listening ? stopListening : startListening}
      >
        <span className="ks-voice__ring">
          {listening ? <Mic size={24} strokeWidth={1.7} /> : <MicOff size={24} strokeWidth={1.7} />}
        </span>
        <span className="ks-voice__text">
          <strong>{listening ? "Voice Protection On" : "Voice Protection Off"}</strong>
          <span>{listening ? "Listening for “help me”" : "Tap to activate hands free SOS"}</span>
        </span>
      </button>

      <div className="ks-statusgrid">
        <div className="ks-statuscell">
          <span className="ks-statuscell__k">Voice</span>
          <span className="ks-statuscell__v"><span className={`ks-dot ${voice.dot}`} />{voice.text}</span>
        </div>
        <div className="ks-statuscell">
          <span className="ks-statuscell__k">GPS</span>
          <span className="ks-statuscell__v"><span className={`ks-dot ${gps.dot}`} />{gps.text}</span>
        </div>
        <div className="ks-statuscell">
          <span className="ks-statuscell__k">Emergency</span>
          <span className="ks-statuscell__v"><span className={`ks-dot ${emergency.dot}`} />{emergency.text}</span>
        </div>
      </div>

      <div className="ks-card">
        <div className="ks-card__head">
          <MapPin size={15} strokeWidth={1.8} />
          <h2>Live Location</h2>
          <span className={`ks-chip ${tracking ? "ks-chip--red" : "ks-chip--ghost"}`}>
            {tracking ? "Broadcasting" : mapLink ? "Captured" : "Not shared"}
          </span>
        </div>
        <div className="ks-card__body">
          {mapLink ? (
            <div className="ks-actions">
              <a className="ks-btn" href={mapLink} target="_blank" rel="noreferrer">
                <ExternalLink size={14} strokeWidth={1.9} /> Google Maps
              </a>
              <a className="ks-btn ks-btn--ghost" href={mapLink} target="_blank" rel="noreferrer">
                <Navigation size={14} strokeWidth={1.9} /> Share position
              </a>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>
              Shared automatically when an alert is sent.
            </p>
          )}
        </div>
      </div>

      <div className="ks-quick">

        <a className="ks-quick__btn" href="tel:112">
          <PhoneCall size={17} strokeWidth={1.8} color="#fca5a5" /> Call 112
        </a>

        <button className="ks-quick__btn" onClick={triggerSOS}>
          <ShieldAlert size={17} strokeWidth={1.8} color="#fca5a5" /> Send SOS
        </button>

        <button
          className="ks-quick__btn"
          onClick={listening ? stopListening : startListening}
        >
          <Mic size={17} strokeWidth={1.8} color="#93c5fd" />
          {listening ? "Stop Voice" : "Voice SOS"}
        </button>

        <button className="ks-quick__btn" onClick={stopTracking} disabled={!tracking}>
          <Square size={17} strokeWidth={1.8} color="#fcd34d" /> Stop Tracking
        </button>

      </div>

      <div className="ks-card">
        <div className="ks-card__head">
          <Phone size={15} strokeWidth={1.8} />
          <h2>Emergency Contacts</h2>
        </div>
        <div className="ks-contacts">
          {CONTACTS.map((contact) => (
            <a className="ks-contact" href={`tel:${contact.number}`} key={contact.number}>
              <span className="ks-contact__icon">
                <contact.icon size={15} strokeWidth={1.8} />
              </span>
              <span className="ks-contact__text">
                <strong>{contact.label}</strong>
                <span>{contact.note}</span>
              </span>
              <span className="ks-contact__num">{contact.number}</span>
            </a>
          ))}
        </div>
      </div>

      <p className="ks-home__foot">
        Press <kbd>SOS</kbd> or say <kbd>HELP ME</kbd>
      </p>

    </main>

  </div>

  );

}
