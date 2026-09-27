import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import HospitalBoard from "../dashboard/network/HospitalBoard";
import RegionMap from "../dashboard/network/RegionMap";
import RoutePlanner from "../dashboard/network/RoutePlanner";
import { clockTime, useNow, useRegion } from "../dashboard/network/ems";
import { apiUrl } from "../api/client";
import logo from "../dashboard/logo.png";
import "../dashboard/dashboard.css";
import "../dashboard/exec.css";
import "../dashboard/ems.css";

// Public board for ambulance crews and dispatchers: no login, no patient data.
function PublicBoard() {
  const region = useRegion();
  const now = useNow();
  const [picked, setPicked] = useState(null);

  return (
    <div className="public">
      <header className="public-bar">
        <div className="ab-brand">
          <span className="ab-mark" aria-hidden="true"><img src={logo} alt="" /></span>
          <div>
            <strong>Tiger Region</strong>
            <small>Hospital availability · by RightDoor</small>
          </div>
        </div>
        <span className={region.offline ? "public-live is-off" : "public-live"}>
          <i />
          {region.offline ? "Reconnecting…" : `Live · updated ${clockTime(region.updatedAt)}`}
        </span>
      </header>
      <main className="page public-page">
        <header className="page-head">
          <div>
            <p className="page-kicker">For ambulance crews and dispatch</p>
            <h1>Take every patient to the right door, the first time.</h1>
            <p className="page-sub">
              Live capacity from every unit of every hospital in the region: emergency, ICU, inpatient beds and operating
              rooms. Pick the patient&apos;s triage and complaint to see where to go, then pre-alert the hospital.
            </p>
          </div>
        </header>
        <div className="net-grid">
          <RoutePlanner onPick={setPicked} />
          <section className="card net-map">
            <header className="card-head">
              <div className="card-titles">
                <p className="card-kicker">Region</p>
                <h2>{region.ambulances.length} ambulances on the road</h2>
              </div>
            </header>
            <RegionMap
              hospitals={region.hospitals}
              zones={region.zones}
              ambulances={region.ambulances}
              now={now}
              highlight={picked}
              onPick={setPicked}
            />
          </section>
        </div>
        <HospitalBoard hospitals={region.hospitals} highlight={picked} onPick={setPicked} />
        <footer className="public-foot">
          <span>Open data: <a href={apiUrl("/api/public/availability")} target="_blank" rel="noreferrer">/api/public/availability</a> · <a href={apiUrl("/fhir/metadata")} target="_blank" rel="noreferrer">FHIR R4</a></span>
          <span>Partner hospitals and ambulance traffic are emulated for this demo.</span>
        </footer>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <PublicBoard />
  </StrictMode>,
);
