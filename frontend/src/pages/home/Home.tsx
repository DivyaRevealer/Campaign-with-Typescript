import "./Home.css";
import dashboardImage from "../../assets/home-screen.png";

export default function Home() {
  return (
    <div className="home">
      <img
        src={dashboardImage}
        alt="Integrated management dashboard showing order and production status"
      />
    </div>
  );
}