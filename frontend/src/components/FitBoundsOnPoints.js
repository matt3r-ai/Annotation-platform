import { useMap } from 'react-leaflet';
import { useEffect } from 'react';

function FitBoundsOnPoints({ points }) {
  const map = useMap();

  useEffect(() => {
    if (points.length > 0) {
      const bounds = points.map(p => [p.lat, p.lon]);
      map.fitBounds(bounds);
    }
  }, [points, map]);

  return null;
}

export default FitBoundsOnPoints;