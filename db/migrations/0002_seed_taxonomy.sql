-- Starting taxonomy, from the team's category list (8 types, 41 subtypes), and the
-- starting scene tags. Everything here is editable by the admin afterwards; this
-- only runs once, on an empty database.

insert into categories (code, name, sort) values
  ('1', 'Perception & fine-grained recognition', 1),
  ('2', 'Counting & traffic-flow estimation', 2),
  ('3', 'Road infrastructure parsing', 3),
  ('4', 'Spatial grounding & lane topology', 4),
  ('5', 'Temporal dynamics & driver behaviour', 5),
  ('6', 'Rule grounding & right-of-way', 6),
  ('7', 'Safety-critical reasoning (road & vehicle safety)', 7),
  ('8', 'Higher-order reasoning', 8);

insert into subtypes (category_id, code, name, keywords, verifiability, regional, sort)
select c.id, s.code, s.name, s.keywords, s.v, s.regional, s.sort
from (values
  ('1', '1.1', 'Object-existence probing (POPE-style hallucination test)', 'Asks about an absent traffic control device: "Is there a signal head?"', 'V', false, 1),
  ('1', '1.2', 'Fine-grained vehicle classification (design-vehicle / vehicle-class taxonomy)', 'Passenger car, single-unit truck, transit bus, motorised three-wheeler, non-motorised vehicle', 'V', true, 2),
  ('1', '1.3', 'Attribute recognition (vehicle geometry & configuration)', 'Axle count, single- vs double-decker, body type', 'V', false, 3),
  ('1', '1.4', 'Part-level state recognition (vehicle lighting & signalling)', 'Brake lamps, turn indicators, high-beam, hazard lamps', 'C', false, 4),
  ('1', '1.5', 'Scene-text recognition / OCR-VQA', 'Licence plate, route board, sign legend', 'V', true, 5),
  ('2', '2.1', 'Instance counting (sparse volume count)', 'Pedestrians crossing, vehicles on an approach', 'V', false, 1),
  ('2', '2.2', 'Class-conditioned counting (classified volume count)', 'Two-wheelers only; parked vs moving', 'C', false, 2),
  ('2', '2.3', 'Density regression under occlusion (traffic density, veh/lane)', 'Count a packed two-wheeler platoon within a bounded range', 'C', true, 3),
  ('2', '2.4', 'Queue-length & level-of-service estimation (LOS A–F)', 'Queued vehicles behind the stop line; free-flow vs stop-and-go', 'C', false, 4),
  ('3', '3.1', 'Road functional classification (arterial / collector / local; divided / undivided)', 'Classify the road and say whether it is divided', 'C', false, 1),
  ('3', '3.2', 'Cross-section element parsing (lane count, shoulder, median, curb, sidewalk)', 'Raised vs flush median, bus bay', 'V', false, 2),
  ('3', '3.3', 'Junction topology classification (T, Y, four-leg, multileg, roundabout, channelised)', 'Also rail grade crossing, median U-turn', 'V', false, 3),
  ('3', '3.4', 'Traffic-control-device recognition (regulatory / warning / guide signs, signal phase, pavement markings)', 'Stop line, zebra crossing, no-passing marking', 'V', false, 4),
  ('3', '3.5', 'Pavement distress detection (cracking, potholes, rutting, raveling, patching)', 'Also waterlogging and unpaved sections', 'C', true, 5),
  ('4', '4.1', 'Ego-lane localisation & region grounding', 'Which vehicles are in the ego lane, on the shoulder, or in the median opening', 'V', false, 1),
  ('4', '4.2', 'Monocular depth ordering (longitudinal position ranking)', 'Rank the vehicles front to back', 'V', false, 2),
  ('4', '4.3', 'Referring-expression comprehension (REC)', '"The rickshaw left of the white van"', 'V', false, 3),
  ('4', '4.4', 'Amodal completion / occlusion reasoning', 'Is a vehicle hidden behind the bus?', 'C', false, 4),
  ('4', '4.5', 'Figure-ground segregation (livery / background confound)', 'A painted figure on a bus that looks like a person', 'V', true, 5),
  ('4', '4.6', 'Pairwise interaction recognition (car-following, cut-in, overtaking)', 'Leader–follower pairs', 'C', false, 6),
  ('5', '5.1', 'Manoeuvre / action recognition (turning movement, lane change, merge, diverge, U-turn)', 'Recognised from a clip', 'V', false, 1),
  ('5', '5.2', 'Kinematic estimation (relative speed, headway, spacing)', 'Which vehicle is fastest; is the follower''s headway under 1 s?', 'C', false, 2),
  ('5', '5.3', 'Gap-acceptance modelling (critical gap, accepted vs rejected gap)', 'Does the left-turner accept this gap?', 'I', false, 3),
  ('5', '5.4', 'Intent prediction (pedestrian crossing intent, lane-change intent)', 'Is the pedestrian about to cross?', 'I', false, 4),
  ('5', '5.5', 'Trajectory forecasting (short-horizon motion prediction)', 'Where things will be in about 3 s', 'I', false, 5),
  ('6', '6.1', 'Visual violation detection (wrong-way, footpath encroachment, stop-line overrun)', 'Visible in a single frame', 'V', false, 1),
  ('6', '6.2', 'Rule-conditioned violation reasoning (traffic-code grounding)', 'Helmet law applied to the frame', 'C', false, 2),
  ('6', '6.3', 'Context-dependent normative reasoning', 'Whether high-beam use is inappropriate', 'I', false, 3),
  ('6', '6.4', 'Right-of-way inference under posted control (signal, stop or yield priority)', 'Who has priority given the device shown', 'C', false, 4),
  ('6', '6.5', 'Negotiated right-of-way at uncontrolled junctions (informal yielding)', 'Who goes first at an unmarked junction', 'I', true, 5),
  ('7', '7.1', 'Crash-contributing-factor attribution (human / vehicle / roadway / environment)', 'Speeding, distraction, missing markings, wet pavement, darkness', 'I', false, 1),
  ('7', '7.2', 'Roadworthiness & overload anomaly detection', 'Riders on the roof, overhanging load, missing lamps', 'C', true, 2),
  ('7', '7.3', 'Vulnerable-road-user (VRU) exposure analysis', 'Pedestrians in the carriageway, no refuge island or crossing', 'C', true, 3),
  ('7', '7.4', 'Clear-zone & roadside-hazard detection', 'Fixed objects, edge drop-off, missing guardrail, open drain, unbarricaded work zone', 'C', false, 4),
  ('7', '7.5', 'Sight-distance & visibility assessment (stopping sight distance, intersection sight triangle)', 'View blocked by a parked bus; glare, night or fog', 'C', false, 5),
  ('7', '7.6', 'Conflict-point & crash-type anticipation (merging / diverging / crossing → rear-end, angle, sideswipe, head-on)', 'Which conflict and which crash if both continue', 'I', false, 6),
  ('7', '7.7', 'Surrogate-safety estimation (TTC / PET, need for evasive action)', 'Must the ego react within 5 s?', 'I', false, 7),
  ('7', '7.8', 'Risk-object identification & countermeasure selection (CMF)', 'Main hazard plus the treatment: median barrier, refuge island, speed hump', 'I', false, 8),
  ('8', '8.1', 'Causal attribution ("why")', 'Why it''s stopped: dwelling at a bus stop, broken down, in a queue, or held by the signal', 'C', false, 1),
  ('8', '8.2', 'Comparative reasoning (relative attribute / kinematic comparison)', 'Closer, larger, or faster', 'C', false, 2),
  ('8', '8.3', 'Counterfactual & ego-planning reasoning', 'If the ego brakes now, what happens?', 'I', false, 3)
) as s(category_code, code, name, keywords, v, regional, sort)
join categories c on c.code = s.category_code;

insert into tag_groups (name, required, sort) values
  ('View', true, 1),
  ('Time of day', true, 2),
  ('Weather & visibility', false, 3),
  ('Traffic density', false, 4),
  ('Location', false, 5);

insert into tags (group_id, name, sort)
select g.id, t.name, t.sort
from (values
  ('View', 'Dashcam', 1), ('View', 'Roadside', 2), ('View', 'CCTV / elevated', 3),
  ('Time of day', 'Day', 1), ('Time of day', 'Night', 2), ('Time of day', 'Dawn / dusk', 3),
  ('Weather & visibility', 'Clear', 1), ('Weather & visibility', 'Rain', 2),
  ('Weather & visibility', 'Fog / haze', 3), ('Weather & visibility', 'Dust', 4),
  ('Weather & visibility', 'Glare', 5),
  ('Traffic density', 'Sparse', 1), ('Traffic density', 'Moderate', 2), ('Traffic density', 'Dense', 3),
  ('Location', 'Intersection', 1), ('Location', 'Mid-block', 2), ('Location', 'Highway', 3),
  ('Location', 'Local street', 4)
) as t(group_name, name, sort)
join tag_groups g on g.name = t.group_name;
