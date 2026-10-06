import { Directive, ElementRef, inject, input, output, signal } from '@angular/core';

const BYTES_POR_MB = 1024 * 1024;

@Directive({
  selector: '[appZonaArchivos]',
  host: {
    '(dragover)': 'alArrastrar($event)',
    '(dragleave)': 'alSalir($event)',
    '(drop)': 'alSoltar($event)',
    '(document:dragover)': 'alArrastrarEnDocumento($event)',
    '(document:drop)': 'alSoltarEnDocumento($event)',
    '[class.arrastrando]': 'arrastrando()',
  },
})
export class ZonaArchivosDirective {
  private readonly zona = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly tipoAceptado = input<string>('image/');
  readonly maximoMb = input<number>(2);
  readonly archivos = output<File[]>();
  readonly rechazo = output<string>();
  readonly arrastrando = signal(false);

  alArrastrar(evento: DragEvent): void {
    evento.preventDefault();

    if (evento.dataTransfer) {
      evento.dataTransfer.dropEffect = 'copy';
    }

    this.arrastrando.set(true);
  }

  alSalir(evento: DragEvent): void {
    evento.preventDefault();

    const destino = evento.relatedTarget;
    if (destino instanceof Node && this.zona.nativeElement.contains(destino)) {
      return;
    }

    this.arrastrando.set(false);
  }

  alSoltar(evento: DragEvent): void {
    evento.preventDefault();
    this.arrastrando.set(false);

    const soltados = Array.from(evento.dataTransfer?.files ?? []);
    if (soltados.length === 0) {
      this.rechazo.emit('Soltá un archivo para subirlo.');
      return;
    }

    const motivos: string[] = [];
    const aceptados = soltados.filter((archivo) => {
      const motivo = this.motivoDeRechazo(archivo);
      if (motivo) {
        motivos.push(motivo);
      }
      return motivo === null;
    });

    if (motivos.length > 0) {
      this.rechazo.emit(motivos.join(' '));
    }

    if (aceptados.length > 0) {
      this.archivos.emit(aceptados);
    }
  }

  alArrastrarEnDocumento(evento: DragEvent): void {
    if (evento.defaultPrevented || !this.traeArchivos(evento)) {
      return;
    }

    evento.preventDefault();

    if (evento.dataTransfer) {
      evento.dataTransfer.dropEffect = 'none';
    }
  }

  alSoltarEnDocumento(evento: DragEvent): void {
    if (this.traeArchivos(evento)) {
      evento.preventDefault();
    }
  }

  private traeArchivos(evento: DragEvent): boolean {
    return Array.from(evento.dataTransfer?.types ?? []).includes('Files');
  }

  private motivoDeRechazo(archivo: File): string | null {
    const tipo = archivo.type.toLowerCase();
    const aceptados = this.tipoAceptado()
      .split(',')
      .map((opcion) => opcion.trim().toLowerCase())
      .filter((opcion) => opcion.length > 0);

    if (aceptados.length > 0 && !aceptados.some((opcion) => tipo.startsWith(opcion))) {
      return `"${archivo.name}" no es un tipo de archivo permitido.`;
    }

    if (archivo.size > this.maximoMb() * BYTES_POR_MB) {
      return `"${archivo.name}" pesa más de ${this.maximoMb()} MB.`;
    }

    return null;
  }
}
