'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, MapPin, ScanFace, XCircle, Eye } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, ErrorBox, Modal } from './ui';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/**
 * Camera attendance: the browser detects faces (MediaPipe, on device) and reads GPS,
 * then sends only face_count + liveness + location. The server stamps the time and decides
 * (exactly one face, accuracy <= 100 m, Haversine distance <= office radius). No photo is stored.
 */
export function CameraCheckIn({ open, mode = 'in', onClose, onDone }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(0);
  const blinkRef = useRef({ closed: false, blinked: false });
  const [phase, setPhase] = useState('starting');
  const [faces, setFaces] = useState(0);
  const [blinked, setBlinked] = useState(false);
  const [geo, setGeo] = useState(null);
  const [geoError, setGeoError] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let landmarker = null;
    let watchId = null;
    blinkRef.current = { closed: false, blinked: false };
    setPhase('starting');
    setFaces(0);
    setBlinked(false);
    setGeo(null);
    setGeoError(null);
    setError(null);

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setPhase('loading-model');
        const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
        const files = await FilesetResolver.forVisionTasks(WASM);
        landmarker = await FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numFaces: 3,
          outputFaceBlendshapes: true,
        });
        if (cancelled) return;
        setPhase('detecting');
        let last = -1;
        const loop = () => {
          const v = videoRef.current;
          if (!v || cancelled) return;
          if (v.currentTime !== last && v.readyState >= 2) {
            last = v.currentTime;
            const res = landmarker.detectForVideo(v, performance.now());
            const n = res.faceLandmarks?.length || 0;
            setFaces(n);
            // Liveness: eyes must close and open again (a blink) while exactly one face is visible.
            if (n === 1 && res.faceBlendshapes?.[0]) {
              const cats = res.faceBlendshapes[0].categories;
              const score = (name) => cats.find((c) => c.categoryName === name)?.score || 0;
              const eyes = (score('eyeBlinkLeft') + score('eyeBlinkRight')) / 2;
              const b = blinkRef.current;
              if (eyes > 0.5) b.closed = true;
              else if (b.closed && eyes < 0.25 && !b.blinked) {
                b.blinked = true;
                setBlinked(true);
              }
            }
          }
          rafRef.current = requestAnimationFrame(loop);
        };
        loop();
      } catch (e) {
        if (!cancelled) {
          setPhase('error');
          setError(new Error(e?.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access or use the normal check-in.' : `Camera not available: ${e?.message || e}`));
        }
      }
    })();

    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (p) => setGeo({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
        (e) => setGeoError(e.code === 1 ? 'Location permission was denied.' : 'Could not read your location.'),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
      );
    } else setGeoError('This browser has no location support.');

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      landmarker?.close?.();
    };
  }, [open]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await api(mode === 'in' ? 'attendance/check-in' : 'attendance/check-out', {
        method: 'POST',
        body: { source: 'camera', face_count: faces, liveness: blinked, lat: geo?.lat, lng: geo?.lng, accuracy: geo?.accuracy },
      });
      onDone?.(r);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const ready = faces === 1 && blinked && geo && geo.accuracy <= 100;
  const Check = ({ ok, children }) => (
    <span className={`badge ${ok ? 'green' : 'orange'}`}>
      {ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />} {children}
    </span>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Camera check-${mode}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!ready} onClick={submit}>
            <Camera size={16} /> Check {mode}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="camera">
          <video ref={videoRef} playsInline muted />
          <div className="overlay">
            <Check ok={faces === 1}>
              <ScanFace size={13} /> {phase !== 'detecting' ? (phase === 'loading-model' ? 'Loading face model…' : 'Starting camera…') : faces === 0 ? 'No face' : faces === 1 ? 'Face detected' : `${faces} faces - only you please`}
            </Check>
            <Check ok={blinked}>
              <Eye size={13} /> {blinked ? 'Blink confirmed' : 'Blink once'}
            </Check>
            <Check ok={geo && geo.accuracy <= 100}>
              <MapPin size={13} /> {geo ? `GPS ±${Math.round(geo.accuracy)} m` : geoError || 'Getting location…'}
            </Check>
          </div>
        </div>
        <ErrorBox error={error} />
        <p className="muted" style={{ fontSize: 12.5 }}>
          Privacy: no photo is uploaded or stored. Only the number of faces detected, the blink check and your location are sent; the server checks you are inside the office
          radius and stamps the time. If this fails, use the normal check-in or ask HR for a correction.
        </p>
      </div>
    </Modal>
  );
}
