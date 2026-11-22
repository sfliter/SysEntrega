import { useEffect, useRef, useState } from 'react';
import { DEMO } from '../api';

// Rubrica desenhada com o dedo, a caneta ou o mouse. Devolve um PNG (data URL)
// ou null quando está em branco.
export default function CampoAssinatura({ aoMudar }: { aoMudar: (png: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const desenhando = useRef(false);
  const [vazio, setVazio] = useState(true);

  // Ajusta a resolução do desenho ao tamanho real da área. Dentro de uma
  // janela, a área só tem tamanho depois que a janela abre — por isso a
  // medida é refeita quando o tamanho muda e no primeiro toque. Redimensionar
  // apaga o desenho, então só acontece enquanto a área está em branco.
  const temDesenho = useRef(false);
  function ajustar() {
    const canvas = ref.current;
    if (!canvas || temDesenho.current) return;
    const escala = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    const largura = Math.round(width * escala);
    const altura = Math.round(height * escala);
    if (!largura || !altura || (canvas.width === largura && canvas.height === altura)) return;
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(escala, escala);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#10213d';
  }

  useEffect(() => {
    ajustar();
    if (typeof ResizeObserver === 'undefined') return;
    const observador = new ResizeObserver(ajustar);
    observador.observe(ref.current!);
    return () => observador.disconnect();
  }, []);

  function ponto(e: React.PointerEvent) {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function iniciar(e: React.PointerEvent) {
    e.preventDefault();
    ajustar();
    ref.current!.setPointerCapture(e.pointerId);
    desenhando.current = true;
    temDesenho.current = true;
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
    const png = ref.current!.toDataURL('image/png');
    // Área sem tamanho não produz imagem: melhor nenhuma rubrica que uma inválida
    if (!png.startsWith('data:image/png;base64,') || png.length < 200) return;
    setVazio(false);
    aoMudar(png);
  }

  function limpar() {
    const canvas = ref.current!;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    temDesenho.current = false;
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
  if (DEMO) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      if (!navigator.geolocation) return resolve(null);
      // Se o aparelho não responder (nem "sim" nem "não"), segue sem ela
      const limite = setTimeout(() => resolve(null), 8000);
      const fim = (v: string | null) => {
        clearTimeout(limite);
        resolve(v);
      };
      navigator.geolocation.getCurrentPosition(
        (p) => fim(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`),
        () => fim(null),
        { timeout: 6000, maximumAge: 60_000 },
      );
    } catch {
      resolve(null);
    }
  });
}
