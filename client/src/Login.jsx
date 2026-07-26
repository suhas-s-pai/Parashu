import { useState } from "react";
import { ShieldAlert, User, Phone, ArrowRight } from "lucide-react";

export default function Login({ setUser }) {

const [name,setName] = useState("");
const [phone,setPhone] = useState("")

const handleLogin = () => {

if(!name || !phone){
alert("Enter your details");
return;
}

const user = {name,phone};

localStorage.setItem("user",JSON.stringify(user));

setUser(user);
};

return(

<div className="ks-login">

<div className="ks-login__card">

<div className="ks-login__mark">
<ShieldAlert size={21} strokeWidth={2} />
</div>

<h1 className="ks-login__title">KaliSOS</h1>
<p className="ks-login__sub">Emergency response platform</p>

<div className="ks-login__form">

<label className="ks-field">
<span className="ks-field__label">Name</span>
<span className="ks-searchwrap" style={{ flex: "none" }}>
<User size={15} strokeWidth={1.8} />
<input
className="ks-input"
type="text"
placeholder="Enter your name"
value={name}
onChange={(e)=>setName(e.target.value)}
onKeyDown={(e)=>{ if(e.key === "Enter") handleLogin(); }}
/>
</span>
</label>

<label className="ks-field">
<span className="ks-field__label">Phone</span>
<span className="ks-searchwrap" style={{ flex: "none" }}>
<Phone size={15} strokeWidth={1.8} />
<input
className="ks-input"
type="tel"
placeholder="Phone number"
value={phone}
onChange={(e)=>setPhone(e.target.value)}
onKeyDown={(e)=>{ if(e.key === "Enter") handleLogin(); }}
/>
</span>
</label>

<button
onClick={handleLogin}
className="ks-btn"
style={{ height: 40, marginTop: 4 }}
>
Continue
<ArrowRight size={15} strokeWidth={2} />
</button>

</div>

</div>

<p className="ks-login__foot">SpringX</p>

</div>

);

}
