-- API connections, and the model catalogue from the proposal (Tables 3–5).
--
-- A connection is one provider account: its API type, base URL and key. Keys are
-- stored encrypted with ENCRYPTION_KEY and never sent back to the browser. A
-- model with no connection has its answers recorded by hand.

create table api_connections (
  id serial primary key,
  name text not null unique,
  -- anthropic: official SDK. google: Gemini API. openai_compatible: OpenAI and
  -- every provider (or self-hosted vLLM/SGLang/Ollama server) speaking its chat API.
  kind text not null check (kind in ('anthropic', 'google', 'openai_compatible')),
  base_url text,
  api_key_enc text,
  -- Last four characters, so the admin can tell keys apart without seeing them.
  key_hint text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- "provider" becomes the developer's name as written in the proposal (OpenAI,
-- Alibaba Qwen, …); how a model is called is now its connection.
alter table models drop constraint if exists models_provider_check;
alter table models
  add column connection_id integer references api_connections (id) on delete set null,
  add column family text not null default 'other' check (family in ('proprietary', 'open_weight', 'driving', 'other')),
  add column funded boolean not null default false,
  add column price_in numeric,
  add column price_out numeric,
  add column request_options jsonb,
  add column sort integer not null default 0;

alter table model_answers
  add column tokens_in integer,
  add column tokens_out integer,
  add column latency_ms integer;

-- Model IDs are filled in only where the API name is certain; the admin adds the
-- rest when a provider's account is connected. Funded models start "in use".
insert into models (name, provider, model_id, family, funded, price_in, price_out, notes, active, sort)
select name, provider, model_id, family, funded, price_in, price_out, notes, funded, sort
from (values
  -- Table 3: proprietary (API) models
  ('GPT-6 Astra', 'OpenAI', null, 'proprietary', false, 10, 50, 'Frontier (newest OpenAI flagship, Sep 2026)', 1),
  ('GPT-6.1 Sol', 'OpenAI', null, 'proprietary', true, 2, 10, 'Mid tier, newest generation', 2),
  ('GPT-6 Luna', 'OpenAI', null, 'proprietary', true, 0.1, 0.5, 'Low-cost, newest generation', 3),
  ('GPT-5.6 Sol', 'OpenAI', null, 'proprietary', false, 5, 30, 'Previous-generation frontier', 4),
  ('GPT-5.6 Terra', 'OpenAI', null, 'proprietary', false, 2, 12, 'Previous-generation mid tier', 5),
  ('GPT-5.6 Luna', 'OpenAI', null, 'proprietary', true, 0.2, 1.2, 'Previous-generation low-cost', 6),
  ('GPT-4o', 'OpenAI', 'gpt-4o', 'proprietary', false, 2.5, 10, 'Legacy baseline named in the original proposal', 7),
  ('o4-mini', 'OpenAI', 'o4-mini', 'proprietary', false, 1.1, 4.4, 'Reasoning-model reference', 8),
  ('Claude Fable 5.1', 'Anthropic', 'claude-fable-5-1', 'proprietary', false, 10, 50, 'Frontier (most capable Claude)', 9),
  ('Claude Opus 5.5', 'Anthropic', 'claude-opus-5-5', 'proprietary', true, 4, 20, 'Frontier; best-calibrated model family in the pilot', 10),
  ('Claude Opus 5', 'Anthropic', 'claude-opus-5', 'proprietary', false, 5, 25, 'The exact model used in the pilot', 11),
  ('Claude Sonnet 5.5', 'Anthropic', 'claude-sonnet-5-5', 'proprietary', false, 2, 10, 'Mid tier', 12),
  ('Claude Haiku 4.5', 'Anthropic', 'claude-haiku-4-5', 'proprietary', true, 1, 5, 'Low-cost; also the LLM judge', 13),
  ('Gemini 3.1 Pro (Preview)', 'Google', null, 'proprietary', true, 2, 12, 'Frontier; made logical-consistency errors in the pilot', 14),
  ('Gemini 3.8 Flash', 'Google', null, 'proprietary', true, 1.5, 7.5, 'Newest Flash; target model for the adaptation experiments', 15),
  ('Gemini 3.7 Flash', 'Google', null, 'proprietary', false, 1.5, 7.5, 'The Flash model used in the pilot', 16),
  ('Gemini 3.5 Flash-Lite', 'Google', null, 'proprietary', true, 0.3, 2.5, 'Low-cost', 17),
  ('Gemini Robotics ER 2 (Preview)', 'Google', null, 'proprietary', false, 1, 5, 'Embodied / spatial-reasoning model', 18),
  ('Grok 4.7', 'xAI', null, 'proprietary', true, 2, 6, 'Frontier; image input confirmed (200 frames budgeted)', 19),
  ('Amazon Nova 2 Pro', 'Amazon (Bedrock)', null, 'proprietary', false, 1.25, 10, 'Frontier-mid', 20),
  ('Amazon Nova 2 Lite', 'Amazon (Bedrock)', null, 'proprietary', false, 0.3, 2.5, 'Low-cost', 21),
  ('Mistral Medium 3.5', 'Mistral', null, 'proprietary', false, 1.5, 7.5, 'Mid tier, European provider', 22),
  ('Mistral Large 3 (API)', 'Mistral', null, 'proprietary', false, 0.5, 1.5, 'Open-weight 675B MoE run through the API', 23),
  ('Reka Core', 'Reka', null, 'proprietary', false, 2, 6, 'Independent multimodal lab (+$0.02 per image)', 24),
  ('Reka Flash', 'Reka', null, 'proprietary', false, 0.8, 2, 'Low-cost (+$0.01 per image)', 25),
  ('Command A Vision', 'Cohere', null, 'proprietary', false, null, null, 'Enterprise model; no public price', 26),
  ('Qwen3.8-Max', 'Alibaba Cloud', null, 'proprietary', false, 2, 6, 'Frontier Chinese model; image and video input', 27),
  ('Qwen3-VL-Plus', 'Alibaba Cloud', null, 'proprietary', true, 0.2, 1.6, 'Dedicated vision line; strong OCR and grounding', 28),
  ('Kimi K3 (API)', 'Moonshot AI', null, 'proprietary', false, 3, 15, 'Open-weight 2.8T MoE run through the API', 29),
  ('GLM-4.6V', 'Zhipu / Z.ai', null, 'proprietary', true, 0.3, 0.9, 'Vision model, low price', 30),
  ('GLM-5V-Turbo', 'Zhipu / Z.ai', null, 'proprietary', false, 1.2, 4, 'Newer GLM vision tier', 31),
  ('Seed 2.0 Pro', 'ByteDance (Doubao)', null, 'proprietary', false, 0.514, 2.57, 'Frontier Chinese model', 32),
  ('ERNIE 5.0', 'Baidu', null, 'proprietary', false, 1.4, 5.6, 'Multimodal flagship (ERNIE 5.1 is text-only)', 33),
  ('deepseek-flash', 'DeepSeek', null, 'proprietary', true, 0.3, 1.2, 'Low-cost with vision (deepseek-v4-pro has none)', 34),
  ('Muse Spark 1.3', 'Meta', null, 'proprietary', false, 1.25, 4.25, 'API-only Meta model, reported multimodal', 35),
  -- Table 4: open-weight models (rented or free GPUs)
  ('Qwen3-VL 8B', 'Alibaba Qwen', null, 'open_weight', true, null, null, 'Strong OCR and grounding; LoRA base candidate. RTX 4090', 101),
  ('Qwen3.5 (small dense, ≤10B)', 'Alibaba Qwen', null, 'open_weight', true, null, null, 'Native image and video. RTX 4090', 102),
  ('InternVL3.5 8B', 'OpenGVLab', null, 'open_weight', true, null, null, 'OCR and reasoning; widely used baseline. RTX 4090', 103),
  ('Gemma 4 12B', 'Google', null, 'open_weight', true, null, null, 'Image input; Google open line. RTX 4090', 104),
  ('Gemma 4 E4B (edge)', 'Google', null, 'open_weight', false, null, null, 'On-device size class (dashcam / phone). RTX 4090', 105),
  ('Ministral 3 8B', 'Mistral', null, 'open_weight', true, null, null, 'Small European model with vision. RTX 4090', 106),
  ('Molmo 2 8B', 'Allen Institute for AI', null, 'open_weight', true, null, null, 'Pointing and video grounding; useful for LOC probes. RTX 4090', 107),
  ('MiniCPM-V 4.5 8B', 'OpenBMB', null, 'open_weight', true, null, null, 'High-resolution, efficient; video. RTX 4090', 108),
  ('MiniCPM-V 4.6 / 4.6-Thinking 1.3B', 'OpenBMB', null, 'open_weight', false, null, null, 'Edge-device reasoning model. RTX 4090', 109),
  ('LLaVA-OneVision-1.5 8B', 'LLaVA community', null, 'open_weight', true, null, null, 'Reproducible academic baseline. RTX 4090', 110),
  ('GLM-4.1V-Thinking 9B', 'Zhipu / Z.ai', null, 'open_weight', true, null, null, 'Small reasoning ("thinking") VLM. RTX 4090', 111),
  ('Cosmos-Reason2 8B', 'NVIDIA', null, 'open_weight', true, null, null, 'Physical-AI reasoning; trained for driving and robotics scenes. RTX 4090', 112),
  ('Ovis2.5 9B', 'AIDC-AI (Alibaba)', null, 'open_weight', true, null, null, 'OCR-strong. RTX 4090', 113),
  ('Idefics3 8B', 'Hugging Face', null, 'open_weight', false, null, null, 'Open-data academic baseline. RTX 4090', 114),
  ('SmolVLM2 2.2B', 'Hugging Face', null, 'open_weight', false, null, null, 'Tiny edge model; lower bound. RTX 4090', 115),
  ('PaliGemma 2 (mix) 10B', 'Google', null, 'open_weight', false, null, null, 'Grounding / detection specialist. RTX 4090', 116),
  ('Florence-2 0.77B', 'Microsoft', null, 'open_weight', true, null, null, 'Grounding specialist; reference for box questions. RTX 4090', 117),
  ('Qwen3.8-27B', 'Alibaba Qwen', null, 'open_weight', true, null, null, 'Newest open Qwen with vision (Aug 2026); ~30B-class LoRA base. A100', 118),
  ('Gemma 4 31B', 'Google', null, 'open_weight', true, null, null, 'Largest Gemma; outputs bounding boxes. A100', 119),
  ('Phi-4-reasoning-vision 15B', 'Microsoft', null, 'open_weight', false, null, null, 'Reasoning on charts and UI; tests transfer to scenes. A100', 120),
  ('Cosmos-Reason2 32B', 'NVIDIA', null, 'open_weight', false, null, null, 'Larger physical-AI reasoning model. A100', 121),
  ('Qwen3.6-35B-A3B', 'Alibaba Qwen', null, 'open_weight', false, null, null, 'Efficient mixture-of-experts (3B active). A100', 122),
  ('Ovis2.6 30B-A3B', 'AIDC-AI (Alibaba)', null, 'open_weight', false, null, null, 'OCR-strong MoE. A100', 123),
  ('Kimi-VL-A3B', 'Moonshot AI', null, 'open_weight', false, null, null, 'Small MoE with long context (16B, 3B active). A100', 124),
  ('Nemotron Nano VL V2 12B', 'NVIDIA', null, 'open_weight', false, null, null, 'Document and scene understanding. A100', 125),
  ('Aria', 'Rhymes AI', null, 'open_weight', false, null, null, 'Earlier open MoE baseline (25B, 3.9B active). A100', 126),
  ('Llama 4 Scout', 'Meta', null, 'open_weight', false, null, null, 'Most-used open multimodal family (109B MoE). Multi-GPU', 127),
  ('Llama 4 Maverick', 'Meta', null, 'open_weight', false, null, null, 'Large Llama (400B MoE). Multi-GPU', 128),
  ('InternVL3.5 241B-A28B', 'OpenGVLab', null, 'open_weight', false, null, null, 'Largest open InternVL. Multi-GPU', 129),
  ('GLM-5.3-Flash', 'Zhipu / Z.ai', null, 'open_weight', false, null, null, 'First natively multimodal GLM-5 (320B MoE, Aug 2026). Multi-GPU', 130),
  ('MiniMax M3', 'MiniMax', null, 'open_weight', false, null, null, 'Image and video (428B MoE). Multi-GPU', 131),
  ('DeepSeek V4-Flash-Vision-Exp', 'DeepSeek', null, 'open_weight', false, null, null, 'Experimental vision release (284B MoE, Aug 2026). Multi-GPU', 132),
  -- Table 5: driving-specific reference models
  ('Impromptu VLA', 'Impromptu VLA authors', null, 'driving', true, null, null, 'Driving VLA trained on corner cases in unstructured roads; closest to Dhaka', 201),
  ('DriveLMM-o1', 'DriveLMM-o1 authors', null, 'driving', true, null, null, 'Step-by-step driving reasoning model (nuScenes)', 202),
  ('Senna', 'HUST Vision Lab', null, 'driving', true, null, null, '7B driving VLM on Vicuna-7B (nuScenes)', 203),
  ('Alpamayo-R1', 'NVIDIA', null, 'driving', false, null, null, '10B driving VLA with reasoning traces; non-commercial licence', 204),
  ('OmniDrive', 'NVIDIA Research', null, 'driving', false, null, null, '3D-aware driving VLM; needs adapting to single-camera input', 205),
  ('DriveLM-Agent', 'OpenDriveLab', null, 'driving', false, null, null, 'DriveLM baseline; ego-view reference. Weights not released yet', 206),
  ('DriveGPT4', 'DriveGPT4 authors', null, 'driving', false, null, null, 'Interpretable end-to-end driving LLM. Weights not released', 207)
) as m(name, provider, model_id, family, funded, price_in, price_out, notes, sort)
where not exists (select 1 from models existing where existing.name = m.name);
