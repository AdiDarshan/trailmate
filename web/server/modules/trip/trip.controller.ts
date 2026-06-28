// Trip controller — HTTP adapter for loading a saved itinerary.

import { tripService } from "./trip.service";

class TripController {
  async get(id: string): Promise<Response> {
    const itinerary = await tripService.load(id);
    if (!itinerary) {
      return Response.json({ error: "Trip not found" }, { status: 404 });
    }
    return Response.json(itinerary);
  }
}

export const tripController = new TripController();
