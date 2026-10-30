<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import type { Frame } from './timeline'
import { timeline, reorder, remove } from './timeline'
import { store, type StoredFrame } from './store'
import { capture } from './capture'
import { IntervalTimer } from './interval'
import { mp4, webm, framesZip, supportedMP4 } from './export'
const frames = ref<Frame[]>([]), fps = ref(12), selected = ref(-1), playhead = ref(-1)
const thumbs = ref<Record<string, string>>({}), camera = ref<HTMLVideoElement | null>(null)
const stream = ref<MediaStream | null>(null), cameraError = ref(''), front = ref(false), focusing = ref(false)
const focusPosition = ref({ x: 50, y: 50 }), flash = ref(false), busy = ref(false)
const onion = ref(true), opacity = ref(40), ghostCount = ref(1), keyframe = ref<string | null>(null)
const thirds = ref(false), safe = ref(false), lines = ref(false), border = ref(true), settings = ref(false)
const mobilePanel = ref(false), framePanel = ref(false)
const interval = ref(0), running = ref(false), countdown = ref(0), wakeHint = ref('')
const playbackUrl = ref(''), playing = ref(false), loop = ref(true), exportMode = ref<'mp4' | 'webm' | 'zip'>('zip')
const exporting = ref(false), exportProgress = ref(0), exportElapsed = ref(0), result = ref<{ file: File; path: string; elapsed: number } | null>(null)
const error = ref(''), notice = ref(''), mp4Available = ref(false)
const canShareResult = computed(() => !!result.value && typeof navigator.canShare === 'function' && navigator.canShare({ files: [result.value.file] }))
function cancelExport() { controller?.abort() }
function openMovie() { settings.value = false; framePanel.value = false; mobilePanel.value = true }
function openSettings() { mobilePanel.value = false; framePanel.value = false; settings.value = !settings.value }
function openFrame() { mobilePanel.value = false; settings.value = false; framePanel.value = true }
function closePanels() { mobilePanel.value = false; framePanel.value = false; settings.value = false }
let wake: WakeLockSentinel | null = null, playbackTimer: ReturnType<typeof setTimeout> | null = null
const intervalTimer = new IntervalTimer()
let intervalGeneration = 0
let controller: AbortController | null = null, resultUrl: string | null = null
let undoState: { order: Frame[]; deleted?: StoredFrame[]; selected: number } | null = null
const timing = computed(() => timeline(frames.value, fps.value))
const current = computed(() => frames.value[selected.value])
const latest = computed(() => frames.value.at(-1))
const previous = computed(() => latest.value ? thumbs.value[latest.value.id] : undefined)
const second = computed(() => frames.value.length > 1 ? thumbs.value[frames.value[frames.value.length - 2].id] : undefined)
const keyImage = computed(() => keyframe.value ? thumbs.value[keyframe.value] : undefined)
const playingImage = computed(() => playbackUrl.value)
const resolution = computed(() => frames.value.length ? `${frames.value[0].width} × ${frames.value[0].height}` : '—')
const canCapture = computed(() => !!stream.value && !busy.value && !playing.value)
async function persist() { await store.save(frames.value, fps.value) }
function urlFor(blob: Blob) { return URL.createObjectURL(blob) }
function discardUrl(id: string) { if (thumbs.value[id]) { URL.revokeObjectURL(thumbs.value[id]); delete thumbs.value[id] } }
async function startCamera() {
  stream.value?.getTracks().forEach(t => t.stop()); stream.value = null; cameraError.value = ''
  try {
    const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: front.value ? 'user' : 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } })
    stream.value = media; await nextTick()
    if (camera.value) { camera.value.srcObject = media; await camera.value.play() }
  } catch { cameraError.value = 'Camera unavailable or blocked. Allow access or import photos.' }
}
async function focus(event: MouseEvent) {
  const element = event.currentTarget as HTMLElement, rect = element.getBoundingClientRect()
  focusPosition.value = { x: (event.clientX - rect.left) / rect.width * 100, y: (event.clientY - rect.top) / rect.height * 100 }; focusing.value = true
  setTimeout(() => focusing.value = false, 650)
  const track = stream.value?.getVideoTracks()[0]
  if (track) {
    try {
      const capabilities = track.getCapabilities() as MediaTrackCapabilities & { focusMode?: string[]; pointsOfInterest?: boolean }
      if (capabilities.focusMode?.includes('manual') && capabilities.pointsOfInterest) await track.applyConstraints({ advanced: [{ focusMode: 'manual', pointsOfInterest: [{ x: focusPosition.value.x / 100, y: focusPosition.value.y / 100 }] }] } as unknown as MediaTrackConstraints)
    } catch { /* visual feedback still confirms the tap */ }
  }
}
async function shoot(signal?: AbortSignal) {
  if (!canCapture.value || !camera.value || signal?.aborted || (running.value && !signal)) return
  busy.value = true; flash.value = true; setTimeout(() => flash.value = false, 90)
  navigator.vibrate?.(25)
  try {
    const { blob, thumb, width, height } = await capture(camera.value)
    if (signal?.aborted) return
    if (frames.value.length && (frames.value[0].width !== width || frames.value[0].height !== height)) { error.value = 'Camera resolution changed. Start a new project to keep one export size.'; return }
    const frame: Frame = { id: crypto.randomUUID(), hold: 1, width, height }
    await store.put({ ...frame, blob, thumb })
    if (signal?.aborted) { await store.deleteFrame(frame.id); return }
    thumbs.value[frame.id] = urlFor(thumb)
    frames.value.push(frame); selected.value = frames.value.length - 1; await persist()
  } catch (e) { error.value = String(e) } finally { busy.value = false }
}
async function importPhotos(event: Event) {
  const input = event.target as HTMLInputElement; const files = Array.from(input.files ?? []).filter(f => f.type.startsWith('image/')).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  try {
    for (const file of files) {
      const bitmap = await createImageBitmap(file); const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height))
      const width = Math.floor(bitmap.width * scale / 2) * 2, height = Math.floor(bitmap.height * scale / 2) * 2
      if (frames.value.length && (frames.value[0].width !== width || frames.value[0].height !== height)) { bitmap.close(); throw new Error('All frames must have the same resolution. Import a matching sequence or start a new project.') }
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height); bitmap.close()
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Image conversion failed')), 'image/jpeg', 0.9))
      const small = document.createElement('canvas'); small.width = 160; small.height = Math.round(160 * height / width); small.getContext('2d')!.drawImage(canvas, 0, 0, small.width, small.height)
      const thumb = await new Promise<Blob>((resolve, reject) => small.toBlob(b => b ? resolve(b) : reject(new Error('Thumbnail failed')), 'image/jpeg', 0.7))
      const frame = { id: crypto.randomUUID(), hold: 1, width, height }; await store.put({ ...frame, blob, thumb }); thumbs.value[frame.id] = urlFor(thumb); frames.value.push(frame)
    }
    selected.value = frames.value.length - 1; await persist(); notice.value = `${files.length} photo${files.length === 1 ? '' : 's'} imported.`
  } catch (e) { error.value = String(e) } finally { input.value = '' }
}
function remember(deleted?: StoredFrame[]) { undoState = { order: frames.value.map(f => ({ ...f })), deleted, selected: selected.value } }
async function undo() {
  if (!undoState) return
  if (undoState.deleted) for (const saved of undoState.deleted) { await store.put(saved); thumbs.value[saved.id] = urlFor(saved.thumb) }
  frames.value = undoState.order; selected.value = undoState.selected; undoState = null; await persist()
}
async function deleteSelected() {
  if (!current.value) return
  const saved = await store.get(current.value.id); if (!saved) return
  remember([saved]); const id = current.value.id; frames.value = remove(frames.value, selected.value)
  selected.value = Math.min(selected.value, frames.value.length - 1); if (keyframe.value === id) keyframe.value = null
  await store.deleteFrame(id); discardUrl(id); await persist()
}
async function duplicate() {
  if (!current.value) return
  const saved = await store.get(current.value.id); if (!saved) return
  const frame = { ...current.value, id: crypto.randomUUID() }; await store.put({ ...frame, blob: saved.blob, thumb: saved.thumb }); thumbs.value[frame.id] = urlFor(saved.thumb)
  frames.value.splice(selected.value + 1, 0, frame); selected.value++; await persist()
}
async function setHold(hold: number) { if (!current.value) return; current.value.hold = hold; await persist() }
let dragged = -1
async function moveSelected(direction: -1 | 1) {
  if (!current.value || selected.value + direction < 0 || selected.value + direction >= frames.value.length) return
  remember(); frames.value = reorder(frames.value, selected.value, selected.value + direction); selected.value += direction; await persist()
}
async function dropAt(index: number) { if (dragged < 0 || dragged === index) return; remember(); const id = current.value?.id; frames.value = reorder(frames.value, dragged, index); selected.value = frames.value.findIndex(f => f.id === id); dragged = -1; await persist() }
async function clearTimeline() {
  if (!frames.value.length) return
  const saved = await store.list(); remember(saved)
  for (const frame of frames.value) discardUrl(frame.id)
  frames.value = []; selected.value = -1; keyframe.value = null
  for (const frame of saved) await store.deleteFrame(frame.id)
  await persist(); notice.value = `Cleared ${saved.length} frames. Undo is available until the next destructive action.`
}
async function clearProject() {
  const count = frames.value.length
  if (!confirm(`Delete this project and its ${count} stored frame${count === 1 ? '' : 's'}? This cannot be undone.`)) return
  stopInterval(); stopPlayback(); controller?.abort(); await store.clear(); Object.keys(thumbs.value).forEach(discardUrl)
  frames.value = []; selected.value = -1; keyframe.value = null; undoState = null; notice.value = `Deleted the project and ${count} stored frame${count === 1 ? '' : 's'}.`
}
async function lockScreen(generation: number) {
  wakeHint.value = ''
  try {
    if (!('wakeLock' in navigator)) { wakeHint.value = 'Screen wake lock unavailable; keep your screen awake.'; return }
    const acquired = await navigator.wakeLock.request('screen')
    if (running.value && generation === intervalGeneration) wake = acquired
    else await acquired.release()
  } catch { if (running.value && generation === intervalGeneration) wakeHint.value = 'Screen wake lock unavailable; keep your screen awake.' }
}
function stopInterval() {
  intervalGeneration++
  running.value = false
  countdown.value = 0
  intervalTimer.stop()
  if (wake) { void wake.release().catch(() => {}); wake = null }
}
async function toggleInterval() {
  if (running.value) { stopInterval(); return }
  if (!canCapture.value || !interval.value) return
  running.value = true
  const generation = ++intervalGeneration
  await lockScreen(generation)
  if (!running.value || generation !== intervalGeneration) return
  intervalTimer.start(interval.value, remaining => { countdown.value = remaining }, signal => shoot(signal))
}
function stopPlayback() { playing.value = false; playhead.value = -1; if (playbackTimer) clearTimeout(playbackTimer); if (playbackUrl.value) URL.revokeObjectURL(playbackUrl.value); playbackUrl.value = '' }
function play() {
  if (playing.value) { stopPlayback(); return }
  if (!frames.value.length) return
  stopInterval(); playing.value = true
  let index = 0, next = performance.now()
  const step = async () => {
    if (!playing.value) return
    if (index >= frames.value.length) { if (!loop.value) { stopPlayback(); return } index = 0; next = performance.now() }
    const saved = await store.get(frames.value[index].id)
    if (!playing.value || !saved) return
    const nextUrl = URL.createObjectURL(saved.blob)
    if (playbackUrl.value) URL.revokeObjectURL(playbackUrl.value)
    playbackUrl.value = nextUrl; playhead.value = index; next += frames.value[index].hold * 1000 / fps.value; index++
    playbackTimer = setTimeout(step, Math.max(0, next - performance.now()))
  }
  void step()
}
async function doExport() {
  if (!frames.value.length || exporting.value) return
  stopPlayback(); stopInterval(); error.value = ''; exporting.value = true; exportProgress.value = 0
  controller = new AbortController(); const started = performance.now(); let clock: ReturnType<typeof setInterval> | undefined
  exportElapsed.value = 0; clock = setInterval(() => exportElapsed.value = (performance.now() - started) / 1000, 200)
  try {
    const path = exportMode.value
    const progress = (n: number) => exportProgress.value = n
    const blob = path === 'mp4' ? await mp4(frames.value, fps.value, controller.signal, progress) : path === 'webm' ? await webm(frames.value, fps.value, controller.signal, progress) : await framesZip(frames.value, fps.value, controller.signal, progress)
    const file = new File([blob], `stopmo.${path}`, { type: blob.type })
    if (resultUrl) URL.revokeObjectURL(resultUrl)
    resultUrl = URL.createObjectURL(file); result.value = { file, path, elapsed: (performance.now() - started) / 1000 }
  } catch (e) { if (!controller.signal.aborted) error.value = String(e) }
  finally { if (clock) clearInterval(clock); exporting.value = false; controller = null }
}
function saveResult() { if (!result.value || !resultUrl) return; const a = document.createElement('a'); a.href = resultUrl; a.download = result.value.file.name; a.click() }
async function shareResult() { if (!result.value) return; try { await navigator.share({ files: [result.value.file] }) } catch (e) { if ((e as Error).name !== 'AbortError') error.value = String(e) } }
function keydown(event: KeyboardEvent) { if (event.code === 'Escape') closePanels(); if (event.code === 'Space' && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement)) { event.preventDefault(); void shoot() } }
watch(fps, () => { void persist() })
watch([() => frames.value[0]?.width, () => frames.value[0]?.height], async () => { if (frames.value.length) mp4Available.value = await supportedMP4(frames.value[0].width, frames.value[0].height) }, { immediate: true })
onMounted(async () => {
  try {
    const saved = await store.load()
    if (saved) { fps.value = saved.fps; frames.value = saved.order }
    const known = new Set(frames.value.map(frame => frame.id))
    // Older versions could save a JPEG before failing to save its reactive timeline.
    // Recover those blobs without decoding every full-resolution image into memory.
    const missing = (await store.ids()).filter(id => !known.has(id))
    for (const id of missing) {
      const stored = await store.get(id)
      if (stored) frames.value.push({ id: stored.id, hold: stored.hold, width: stored.width, height: stored.height })
    }
    for (const frame of frames.value) {
      const stored = await store.get(frame.id)
      if (stored) thumbs.value[frame.id] = urlFor(stored.thumb)
    }
    if (missing.length) {
      await persist()
      notice.value = `Recovered ${missing.length} photo${missing.length === 1 ? '' : 's'} from storage. Check their order.`
    }
    selected.value = frames.value.length - 1
  } catch (e) { error.value = `Could not open saved project: ${e}` }
  if ('mediaDevices' in navigator && navigator.mediaDevices) await startCamera(); else cameraError.value = 'Camera unavailable in this browser. Import photos to start.'
  window.addEventListener('keydown', keydown)
})
onUnmounted(() => { stopInterval(); stopPlayback(); stream.value?.getTracks().forEach(t => t.stop()); Object.keys(thumbs.value).forEach(discardUrl); if (resultUrl) URL.revokeObjectURL(resultUrl); window.removeEventListener('keydown', keydown) })
</script>
<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark">●</span> stopmo<span class="brand-dot">.</span></div>
      <div class="top-meta"><span class="project-label">UNTITLED PROJECT</span><span class="status-dot"></span><span>Saved on this device</span></div>
      <button class="quiet header-settings" @click="openSettings">Settings</button>
      <button class="mobile-header-button" @click="openMovie">Movie <span aria-hidden="true">↗</span></button>
    </header>

    <main class="workspace">
      <section class="studio">
        <div class="studio-heading"><div><div class="eyebrow">STUDIO / 01</div><h1>Make a little movie.</h1></div><span class="studio-subtitle">Move it. Frame it. Bring it to life.</span></div>
        <div class="viewfinder" @click="focus">
          <video v-show="!!stream && !playing" ref="camera" autoplay playsinline muted :class="{ mirrored: front }"></video>
          <div v-if="playing && playingImage" class="playback-image" :style="{ backgroundImage: `url(${playingImage})` }"></div>
          <div v-if="!stream && !playing" class="camera-placeholder">
            <div class="placeholder-symbol">◌</div><strong>Camera is off</strong>
            <p>{{ cameraError || 'Allow camera access, or import photos.' }}</p>
            <div class="placeholder-actions"><button class="light-button" @click.stop="startCamera">Try camera</button><label class="light-button file-label">Import photos<input type="file" accept="image/*" multiple @change="importPhotos"></label></div>
          </div>
          <template v-if="!playing && stream && onion">
            <div v-if="keyImage" class="ghost key-ghost" :class="{ mirrored: front }" :style="{ backgroundImage: `url(${keyImage})`, opacity: opacity / 200 }"></div>
            <div v-if="second && ghostCount === 2" class="ghost" :class="{ mirrored: front }" :style="{ backgroundImage: `url(${second})`, opacity: opacity / 200 }"></div>
            <div v-if="previous" class="ghost" :class="{ mirrored: front }" :style="{ backgroundImage: `url(${previous})`, opacity: opacity / 100 }"></div>
          </template>
          <div v-if="border" class="frame-border"></div><div v-if="thirds" class="thirds"></div><div v-if="safe" class="safe-border"></div><div v-if="lines" class="guide-lines"></div>
          <div v-if="focusing && stream" class="focus-ring" :style="{ left: `${focusPosition.x}%`, top: `${focusPosition.y}%` }"></div>
          <div v-if="flash" class="flash"></div>
          <div class="viewfinder-top"><span class="live-badge"><i></i>{{ playing ? 'PLAYBACK' : stream ? 'LIVE' : 'NO CAMERA' }}</span><span class="viewfinder-resolution">{{ stream && camera?.videoWidth ? `${camera.videoWidth} × ${camera.videoHeight}` : resolution }}</span></div>
          <div v-if="running" class="countdown">{{ busy ? '●' : countdown }}<span>{{ busy ? 'CAPTURING' : 'NEXT FRAME' }}</span></div>
          <button v-if="running" class="interval-stop" type="button" @click.stop="stopInterval">■ Stop timer</button>
          <div class="viewfinder-bottom"><span>FRAME {{ String(playing ? playhead + 1 : frames.length + 1).padStart(3, '0') }}</span><span>{{ front ? 'FRONT · MIRRORED PREVIEW' : 'BACK CAMERA' }}</span></div>
        </div>
        <div class="camera-tools">
          <button class="tool-button" :class="{ active: onion }" :aria-pressed="onion" @click="onion = !onion"><span class="tool-glyph">◐</span> Onion skin <span class="tool-state">{{ onion ? 'ON' : 'OFF' }}</span></button>
          <button class="tool-button" @click="front = !front; stopInterval(); startCamera()"><span class="tool-glyph">↻</span> Flip camera</button>
          <button class="tool-button" @click="openSettings"><span class="tool-glyph">⌗</span> Guides &amp; settings</button>
          <label class="tool-button file-label"><span class="tool-glyph">＋</span> Import frames<input type="file" accept="image/*" multiple @change="importPhotos"></label>
        </div>
        <div class="mobile-quickbar">
          <button :class="{ active: running }" @click="interval ? toggleInterval() : openMovie()">{{ running ? `■ Stop · ${countdown}s` : interval ? `◷ Timer · ${interval}s` : '◷ Timer' }}</button>
          <button @click="front = !front; stopInterval(); startCamera()">↻ Flip</button>
          <button @click="openSettings">⌗ Guides</button>
        </div>
        <div v-if="settings" class="settings-panel" role="dialog" aria-label="Camera settings">
          <div class="settings-title">Camera settings <button class="quiet" @click="settings = false">Done ✕</button></div>
          <div class="settings-row"><label for="opacity">Onion opacity</label><select id="opacity" v-model.number="opacity"><option :value="20">20%</option><option :value="40">40%</option><option :value="60">60%</option></select><label for="ghost">Previous frames</label><select id="ghost" v-model.number="ghostCount"><option :value="1">One</option><option :value="2">Two</option></select></div>
          <div class="settings-row toggles"><label><input type="checkbox" v-model="border"> Frame border</label><label><input type="checkbox" v-model="thirds"> Rule of thirds</label><label><input type="checkbox" v-model="safe"> Safe area</label><label><input type="checkbox" v-model="lines"> Horizon + vertical</label></div>
          <p>Front preview mirrors. Saved frames do not.</p>
          <label class="light-button file-label settings-import">＋ Import photos<input type="file" accept="image/*" multiple @change="importPhotos"></label>
        </div>
      </section>

      <aside class="side-panel" :class="{ 'mobile-open': mobilePanel }" aria-label="Movie settings">
        <div class="mobile-sheet-title"><strong>Your movie</strong><button class="quiet" @click="mobilePanel = false">Done ✕</button></div>
        <div class="panel-heading"><div class="eyebrow">YOUR ANIMATION</div><div class="panel-count">{{ frames.length }} <span>frames</span></div></div>
        <div class="stats"><div><span>DURATION</span><strong>{{ timing.durationSeconds.toFixed(1) }} s</strong></div><div><span>FRAME RATE</span><strong>{{ fps }} fps</strong></div><div><span>RESOLUTION</span><strong class="resolution">{{ resolution }}</strong></div></div>
        <div class="side-divider"></div>
        <div class="side-group"><label>Playback speed</label><div class="segmented"><button v-for="rate in [6,8,12,15,24]" :key="rate" :class="{ chosen: fps === rate }" @click="fps = rate">{{ rate }}</button></div><small>frames per second</small></div>
        <div class="side-group"><label>Interval shooting</label><div class="segmented"><button v-for="value in [0,1,2,3,5]" :key="value" :class="{ chosen: interval === value }" :disabled="running" @click="interval = value">{{ value ? `${value}s` : 'Off' }}</button></div><small>Hands-free shooting</small><button v-if="interval" class="interval-button" :class="{ recording: running }" @click="toggleInterval(); mobilePanel = false">{{ running ? 'Stop timer' : 'Start timer' }}</button><small v-if="wakeHint" class="warning">{{ wakeHint }}</small></div>
        <div class="side-divider"></div>
        <div class="side-group export-group"><div class="eyebrow">FINISH YOUR MOVIE</div><label for="format">Export format</label><select id="format" v-model="exportMode"><option value="zip">Frames ZIP · always available</option><option value="mp4" :disabled="!mp4Available">MP4 · H.264 exact timing{{ mp4Available ? '' : ' (unavailable)' }}</option><option value="webm">WebM · real-time recording</option></select><small v-if="exportMode === 'webm'">Records in real time; may drift by one frame.</small><small v-else-if="exportMode === 'mp4'">Exact frame timestamps.</small><small v-else>JPEG frames + timeline with holds.</small><button class="export-button" :disabled="!frames.length || exporting" @click="doExport">{{ exporting ? 'Exporting…' : 'Export movie' }} <span>↗</span></button><div v-if="exporting" class="export-status"><div class="progress-track"><div :style="{ width: `${exportProgress * 100}%` }"></div></div><span>{{ Math.round(exportProgress * 100) }}% · {{ exportProgress > 0 ? `~${Math.ceil(exportElapsed / exportProgress - exportElapsed)}s remaining` : 'Preparing…' }}</span><button class="quiet" @click="cancelExport">Cancel export</button></div></div>
        <button class="movie-delete quiet danger" @click="clearProject">Delete project</button><div class="panel-footer">Saved here. No uploads.</div>
      </aside>
    </main>

    <section class="bottom-dock">
      <div class="timeline-header"><div><span class="eyebrow">TIMELINE</span><span class="timeline-caption">{{ frames.length ? ` ${frames.length} frames · ${timing.durationFrames} held frames` : ' Your story starts with one frame' }}</span><span class="mobile-timeline-count">{{ frames.length }} frames · {{ timing.durationSeconds.toFixed(1) }}s</span></div><div class="timeline-actions"><button class="quiet" :disabled="!undoState" @click="undo">↶ Undo</button><button class="quiet" :disabled="!frames.length" @click="loop = !loop">Loop {{ loop ? 'on' : 'off' }}</button><button class="quiet" :disabled="!frames.length" @click="clearTimeline">Clear frames</button><button class="quiet danger" @click="clearProject">Delete project</button></div><div class="mobile-timeline-actions"><button class="mobile-undo-button" :disabled="!undoState" @click="undo">↶ Undo</button><button class="mobile-edit-button" :disabled="!current" @click="openFrame">Edit frame ↗</button></div></div>
      <div class="strip" aria-label="Frame timeline"><button v-if="!frames.length" class="empty-frame" @click="shoot()">＋<span>First frame</span></button><button v-for="(frame, index) in frames" :key="frame.id" class="frame-tile" :class="{ selected: selected === index, playing: playhead === index }" draggable="true" @dragstart="dragged = index" @dragend="dragged = -1" @dragover.prevent @drop.prevent="dropAt(index)" @click="selected = index" :aria-label="`Frame ${index + 1}, hold ${frame.hold}`"><img :src="thumbs[frame.id]" alt=""><span class="tile-number">{{ String(index + 1).padStart(2, '0') }}</span><span v-if="frame.hold > 1" class="tile-hold">×{{ frame.hold }}</span><span v-if="keyframe === frame.id" class="tile-key">KEY</span></button></div>
      <div class="dock-controls"><div class="frame-edit"><span class="selection-text">{{ current ? `FRAME ${String(selected + 1).padStart(2, '0')} / ${String(frames.length).padStart(2, '0')}` : 'NO FRAME SELECTED' }}</span><div v-if="current" class="edit-buttons"><label>Hold <select :value="current.hold" @change="setHold(Number(($event.target as HTMLSelectElement).value))"><option v-for="n in 9" :key="n" :value="n">{{ n }}×</option></select></label><button class="quiet" @click="keyframe = keyframe === current.id ? null : current.id">{{ keyframe === current.id ? 'Unpin key' : 'Pin key' }}</button><button class="quiet" @click="duplicate">Duplicate</button><button class="quiet danger" @click="deleteSelected">Delete</button></div></div><div class="transport"><button class="play-button" :disabled="!frames.length" @click="play">{{ playing ? '■ Stop' : '▶ Play' }}</button><button class="shutter" :disabled="!canCapture || running" aria-label="Capture frame" @click="shoot()"><span></span></button><span class="shutter-label">CAPTURE FRAME <small>SPACE BAR</small></span><button class="mobile-onion" :class="{ active: onion }" :aria-pressed="onion" @click="onion = !onion">◐<span>Onion {{ onion ? 'on' : 'off' }}</span></button></div></div>
    </section>

    <div v-if="mobilePanel || framePanel || settings" class="sheet-scrim" @click="closePanels"></div>
    <div v-if="framePanel && current" class="frame-sheet" role="dialog" aria-label="Edit frame">
      <div class="mobile-sheet-title"><strong>Frame {{ selected + 1 }}</strong><button class="quiet" @click="framePanel = false">Done ✕</button></div>
      <label class="frame-hold-label">Hold <select :value="current.hold" @change="setHold(Number(($event.target as HTMLSelectElement).value))"><option v-for="n in 9" :key="n" :value="n">{{ n }}×</option></select></label>
      <div class="frame-move-actions"><button :disabled="selected === 0" @click="moveSelected(-1)">← Move left</button><button :disabled="selected === frames.length - 1" @click="moveSelected(1)">Move right →</button></div>
      <div class="frame-sheet-actions"><button @click="keyframe = keyframe === current.id ? null : current.id; framePanel = false">{{ keyframe === current.id ? 'Unpin keyframe' : 'Pin as keyframe' }}</button><button @click="duplicate(); framePanel = false">Duplicate frame</button><button class="danger" @click="deleteSelected(); framePanel = false">Delete frame</button></div>
      <div class="frame-sheet-footer"><button :disabled="!undoState" @click="undo(); framePanel = false">↶ Undo</button><button :disabled="!frames.length" @click="clearTimeline(); framePanel = false">Clear frames</button><button class="danger" @click="clearProject(); framePanel = false">Delete project</button></div>
    </div>
    <div v-if="error || notice" class="toast" role="status"><span>{{ error || notice }}</span><button @click="error = ''; notice = ''">Dismiss</button></div>
    <div v-if="result" class="modal-backdrop"><div class="result-card"><button class="close-result quiet" @click="result = null">Close ✕</button><div class="eyebrow">EXPORT COMPLETE</div><h2>Your movie is ready.</h2><p class="result-path">{{ result.path === 'mp4' ? 'MP4, H.264, exact timing' : result.path === 'webm' ? 'WebM, recorded in real time (can drift by one frame)' : 'ZIP, JPEG frames and timeline with holds' }}</p><div class="result-grid"><div><span>FRAMES</span><strong>{{ frames.length }}</strong></div><div><span>TIMELINE</span><strong>{{ timing.durationSeconds.toFixed(1) }} s</strong></div><div><span>RESOLUTION</span><strong>{{ resolution }}</strong></div><div><span>FILE SIZE</span><strong>{{ (result.file.size / 1024 / 1024).toFixed(2) }} MB</strong></div><div><span>EXPORT TIME</span><strong>{{ result.elapsed.toFixed(1) }} s</strong></div></div><div class="result-actions"><button class="export-button" @click="saveResult">Save file ↓</button><button v-if="canShareResult" class="light-button" @click="shareResult">Share file ↗</button></div></div></div>
  </div>
</template>
