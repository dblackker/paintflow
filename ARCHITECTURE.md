
## Production Rates System

### Overview
PaintFlow now includes a production rates engine comparable to PaintScout, enabling sq ft/hour based estimates with room-by-room breakdowns.

### Database Schema
- `production_rates` - Rate library (category, surface_type, rate_per_hour, hourly_rate)
- `estimate_rooms` - Rooms per estimate (master bedroom, kitchen, etc.)
- `estimate_room_items` - Surfaces within rooms with dimensions
- `estimate_photos` - Photo uploads with annotations

### Calculation Flow
1. User adds rooms (e.g., "Master Bedroom")
2. For each surface, select production rate (walls, ceilings, trim)
3. Enter dimensions (width × height = sq ft)
4. System calculates: `hours = (sqft / rate_per_hour) × coats × prep_multiplier`
5. Labor cost = `hours × hourly_rate`

### Prep Multipliers
- none: 0.8x (no prep)
- light: 1.0x
- standard: 1.2x (default)
- heavy: 1.5x (repairs, sanding)

### Default Rates
- Walls (drywall): 400 sq ft/hr
- Ceilings: 300 sq ft/hr
- Trim: 80 linear ft/hr
- Doors: 4 per hr
- Cabinets: 0.5 per hr (2 hrs per door)

### API Endpoints
- `GET /v1/production-rates` - List rates (seeds defaults)
- `POST /v1/production-rates` - Create custom rate
- `PUT /v1/production-rates/:id` - Update rate
- `DELETE /v1/production-rates/:id` - Delete rate
- `POST /v1/production-rates/calculate` - Calculate totals

### UI Pages
- `/estimates/production` - Room-by-room estimate builder
- `/production-rates` - Manage rate library
