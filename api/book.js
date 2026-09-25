import { readConfigFile } from '../lib/core.js';
import { resolveBookingLink, decodeItinerary, googleBookingUrl, googleSearchUrl } from '../lib/googleFlights.js';

// Redirects to the airline's (or cheapest seller's) booking page for an exact itinerary.
export default async function handler(req, res) {
  const config = readConfigFile();
  const redirect = (url) => {
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, url);
  };

  let itinerary;
  try {
    itinerary = decodeItinerary(req.query.t);
  } catch {
    return redirect(googleSearchUrl(config));
  }

  try {
    const link = await resolveBookingLink(config, itinerary.outbound, itinerary.inbound, {
      prefer: req.query.prefer === 'cheapest' ? 'cheapest' : 'direct'
    });
    redirect(link?.url || googleBookingUrl(config, itinerary.outbound, itinerary.inbound));
  } catch {
    redirect(googleBookingUrl(config, itinerary.outbound, itinerary.inbound));
  }
}
