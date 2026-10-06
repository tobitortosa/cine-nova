import { Directive, ElementRef, Renderer2, inject, input, signal } from '@angular/core';

const RESPALDO_POR_DEFECTO = '/sin-imagen.svg';

@Directive({
  selector: 'img[appImagenRespaldo]',
  host: {
    '(error)': 'alFallar()',
    '(load)': 'alCargar()',
    '[class.imagen-respaldo]': 'conRespaldo()',
  },
})
export class ImagenRespaldoDirective {
  private readonly imagen = inject<ElementRef<HTMLImageElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);

  readonly appImagenRespaldo = input<string>('');
  readonly conRespaldo = signal(false);

  alFallar(): void {
    const elemento = this.imagen.nativeElement;
    const respaldo = this.respaldo();

    this.conRespaldo.set(true);

    if (elemento.src === respaldo) {
      return;
    }

    this.renderer.setAttribute(elemento, 'src', respaldo);
  }

  alCargar(): void {
    this.conRespaldo.set(this.imagen.nativeElement.src === this.respaldo());
  }

  private respaldo(): string {
    const ruta = this.appImagenRespaldo().trim() || RESPALDO_POR_DEFECTO;
    return new URL(ruta, this.imagen.nativeElement.baseURI).href;
  }
}
