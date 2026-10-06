import { DestroyRef, Directive, ElementRef, Renderer2, inject } from '@angular/core';

@Directive({
  selector: 'input[appSoloDigitos]',
  host: {
    inputmode: 'numeric',
    '(beforeinput)': 'alEscribir($event)',
  },
})
export class SoloDigitosDirective {
  private readonly campo = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;

  constructor() {
    const dejarDeEscuchar = inject(Renderer2).listen(this.campo, 'input', () => this.limpiar(), {
      capture: true,
    });
    inject(DestroyRef).onDestroy(dejarDeEscuchar);
  }

  alEscribir(evento: Event): void {
    const texto = (evento as InputEvent).data;
    if (!texto || !/\D/.test(texto) || !evento.cancelable) return;

    evento.preventDefault();

    const inicio = this.campo.selectionStart ?? this.campo.value.length;
    const fin = this.campo.selectionEnd ?? inicio;
    const lugar = this.tope() - (this.campo.value.length - (fin - inicio));
    const digitos = texto.replace(/\D/g, '').slice(0, Math.max(0, lugar));
    if (!digitos) return;

    this.campo.setRangeText(digitos, inicio, fin, 'end');
    this.campo.dispatchEvent(new Event('input', { bubbles: true }));
  }

  private limpiar(): void {
    const valor = this.campo.value;
    const limpio = valor.replace(/\D/g, '').slice(0, this.tope());
    if (limpio === valor) return;

    const cursor = this.campo.selectionStart ?? valor.length;
    const posicion = Math.min(valor.slice(0, cursor).replace(/\D/g, '').length, limpio.length);
    this.campo.value = limpio;
    this.campo.setSelectionRange(posicion, posicion);
  }

  private tope(): number {
    return this.campo.maxLength > 0 ? this.campo.maxLength : Number.POSITIVE_INFINITY;
  }
}
