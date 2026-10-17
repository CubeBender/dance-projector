--[[
Pause media off air
-------------------
Pauses every media source (video/audio file, VLC playlist) when it stops being shown on the
program output, and resumes it from the same frame when it comes back on air.

Fixes: "when switching to scenes with videos, the videos did not pause in the background,
so we returned to them at random timestamps".

Notes
- Works with nested scenes: a source counts as on air when any program scene shows it.
- Preview in studio mode does not count as on air, so a video waits until you take the scene.
- Set the media source option "Restart playback when source becomes active" OFF,
  otherwise OBS itself restarts the video and resuming is not possible.
- Sources listed in "Restart from the beginning" are rewound instead of resumed (e.g. an intro clip).

Load: Tools > Scripts > + > pause-media-off-air.lua
--]]

obs = obslua

local MEDIA_IDS = { ffmpeg_source = true, vlc_source = true }
local restart_names = {}
local enabled = true

local function log(msg) obs.script_log(obs.LOG_INFO, msg) end

local function on_activate(cd)
  if not enabled then return end
  local src = obs.calldata_source(cd, "source")
  if src == nil then return end
  local name = obs.obs_source_get_name(src)
  if restart_names[name] then
    obs.obs_source_media_restart(src)
    log("on air, restarted: " .. name)
  else
    obs.obs_source_media_play_pause(src, false)
    log("on air, resumed: " .. name)
  end
end

local function on_deactivate(cd)
  if not enabled then return end
  local src = obs.calldata_source(cd, "source")
  if src == nil then return end
  obs.obs_source_media_play_pause(src, true)
  log("off air, paused: " .. obs.obs_source_get_name(src))
end

local function hook(src)
  if src == nil then return end
  local id = obs.obs_source_get_unversioned_id(src)
  if not MEDIA_IDS[id] then return end
  local sh = obs.obs_source_get_signal_handler(src)
  obs.signal_handler_connect(sh, "activate", on_activate)
  obs.signal_handler_connect(sh, "deactivate", on_deactivate)
  -- A media source that is loaded while off air should not run in the background either.
  if not obs.obs_source_active(src) then obs.obs_source_media_play_pause(src, true) end
end

local function on_source_create(cd)
  hook(obs.calldata_source(cd, "source"))
end

-- Safety net every 2 s: a media source that is off air must not be playing. This catches files that were
-- still opening when the first pause was sent (e.g. right after OBS starts or a scene collection loads).
-- A file that was paused while still opening can report "paused" and keep running; its position moving
-- while off air gives it away, and a fresh play+pause stops it for real.
local last_pos = {}
local function sweep()
  if not enabled then return end
  local sources = obs.obs_enum_sources()
  if sources == nil then return end
  for _, src in ipairs(sources) do
    if MEDIA_IDS[obs.obs_source_get_unversioned_id(src)] then
      local name = obs.obs_source_get_name(src)
      local pos = obs.obs_source_media_get_time(src)
      if obs.obs_source_active(src) then
        last_pos[name] = nil
      else
        local state = obs.obs_source_media_get_state(src)
        if state == obs.OBS_MEDIA_STATE_PLAYING then
          obs.obs_source_media_play_pause(src, true)
          log("off air but playing, paused: " .. name)
        elseif state == obs.OBS_MEDIA_STATE_PAUSED and last_pos[name] ~= nil and pos > last_pos[name] then
          obs.obs_source_media_play_pause(src, false)
          obs.obs_source_media_play_pause(src, true)
          log("off air and still running while paused, paused again: " .. name)
        end
        last_pos[name] = pos
      end
    end
  end
  obs.source_list_release(sources)
end

function script_description()
  return "Pauses video and audio files when they go off air and resumes them from the same frame when they come back.\n\nTurn OFF \"Restart playback when source becomes active\" on the media sources."
end

function script_properties()
  local p = obs.obs_properties_create()
  obs.obs_properties_add_bool(p, "enabled", "Pause media when off air")
  obs.obs_properties_add_text(p, "restart", "Restart from the beginning (source names, one per line)", obs.OBS_TEXT_MULTILINE)
  return p
end

function script_defaults(settings)
  obs.obs_data_set_default_bool(settings, "enabled", true)
  obs.obs_data_set_default_string(settings, "restart", "")
end

function script_update(settings)
  enabled = obs.obs_data_get_bool(settings, "enabled")
  restart_names = {}
  for line in string.gmatch(obs.obs_data_get_string(settings, "restart") or "", "[^\r\n]+") do
    local n = line:match("^%s*(.-)%s*$")
    if n ~= "" then restart_names[n] = true end
  end
end

function script_load(settings)
  local sources = obs.obs_enum_sources()
  if sources ~= nil then
    for _, src in ipairs(sources) do hook(src) end
    obs.source_list_release(sources)
  end
  obs.signal_handler_connect(obs.obs_get_signal_handler(), "source_create", on_source_create)
  obs.timer_add(sweep, 2000)
  log("loaded")
end

function script_unload()
  obs.timer_remove(sweep)
end
