import { useEffect, useRef, useState } from 'react';

// Rubrica desenhada com o dedo, a caneta ou o mouse. Devolve um PNG (data URL)
// ou null quando está em branco.
export default function CampoAssinatura({ aoMudar }: { aoMudar: (png: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const desenhando = useRef(false);
  const [vazio, setVazio] = useState(true);

  useEffect(() => {
    const canvas = ref.current!;
    const escala = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.round(width * escala);
    canvas.height = Math.round(height * escala);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(escala, escala);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#10213d';
  }, []);

  function ponto(e: React.PointerEvent) {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function iniciar(e: React.PointerEvent) {
    e.preventDefault();
    ref.current!.setPointerCapture(e.pointerId);
    desenhando.current = true;
    const ctx = ref.current!.getContext('2d')!;
    const p = ponto(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }

  function mover(e: React.PointerEvent) {
    if (!desenhando.current) return;
    const ctx = ref.current!.getContext('2d')!;
    const p = ponto(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function terminar() {
    if (!desenhando.current) return;
    desenhando.current = false;
    setVazio(false);
    aoMudar(ref.current!.toDataURL('image/png'));
  }

  function limpar() {
    const canvas = ref.current!;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    setVazio(true);
    aoMudar(null);
  }

  return (
    <div className="rubrica">
      <canvas
        ref={ref}
        className="rubrica-area"
        aria-label="Área para desenhar a assinatura"
        onPointerDown={iniciar}
        onPointerMove={mover}
        onPointerUp={terminar}
        onPointerCancel={terminar}
      />
      <div className="rubrica-pe">
        <span className="suave">{vazio ? 'Assine dentro do quadro' : 'Assinatura registrada'}</span>
        <button type="button" className="link" onClick={limpar} disabled={vazio}>
          Limpar
        </button>
      </div>
    </div>
  );
}

// Pede a localização do aparelho. Recusar não impede nada: devolve null.
export function obterLocalizacao(): Promise<string | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`),
      () => resolve(null),
      { timeout: 6000, maximumAge: 60_000 },
    );
  });
}
