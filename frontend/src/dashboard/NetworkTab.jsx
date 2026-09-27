import { useState } from "react";
import HospitalBoard from "./network/HospitalBoard";
import RegionMap from "./network/RegionMap";
import RoutePlanner from "./network/RoutePlanner";
import { clockTime, useNow, useRegion } from "./network/ems";
import { PageHead } from "./ui";

export default function NetworkTab({ onSent }) {
  const region = useRegion();
  const now = useNow();
  const [picked, setPicked] = useState(null);
  const accepting = region.hospitals.filter((row) => row.ems_status === "accepting").length;

  return (
    <div className="page">
      <PageHead
        kicker="Regional network"
        title="Where should this ambulance go?"
        sub="Every hospital publishes live capacity in every unit, not only the emergency room. Ambulance crews see it before they choose a door."
      >
        <a className="net-pill" href="/public.html" target="_blank" rel="noreferrer">
          Open public board ↗
        </a>
      </PageHead>

      <div className="net-grid">
        <RoutePlanner onSent={onSent} onPick={setPicked} />
        <section className="card net-map">
          <header className="card-head">
            <div className="card-titles">
              <p className="card-kicker">Tiger Region · live</p>
              <h2>{accepting} of {region.hospitals.length || 4} hospitals accepting · {region.ambulances.length} ambulances on the road</h2>
            </div>
            <span className="net-updated">Updated {clockTime(region.updatedAt)}</span>
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
      <p className="emulated-note">
        Tiger Memorial reads its live census. Partner hospitals and ambulance traffic are emulated for this demo.
      </p>
    </div>
  );
}
