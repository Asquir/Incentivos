# Mis Incentivos

Aplicación web para apuntar ventas y calcular el incentivo mensual según la
fórmula de incentivos de la empresa ("Resumen nueva fórmula de incentivos").

Es un único fichero (`index.html`) sin dependencias: funciona abriéndolo en
cualquier navegador, en el móvil o en el ordenador. Los datos se guardan en el
propio dispositivo (localStorage), no salen a ningún servidor.

## Cómo funciona el cálculo

El incentivo se calcula en 3 partes encadenadas:

**Parte 1 · Cuantitativa (ventas)** — la facturación del mes × un porcentaje
según tramo:

| Nivel | Facturación | % |
|---|---|---|
| 1 | 0 – 5.000 € | 0,00 % |
| 2 | 5.001 – 20.000 € | 0,10 % |
| 3 | 20.001 – 46.000 € | 0,15 % |
| 4 | 46.001 – 70.000 € | 0,25 % |
| 5 | 70.001 € o más | 0,30 % |

**Parte 2 · Cualitativa (score)** — el resultado anterior × un multiplicador
según el score acumulado:

| Nivel | Score | Multiplicador |
|---|---|---|
| 1 | 0 – 100 | × 1,00 |
| 2 | 101 – 250 | × 1,50 |
| 3 | 251 – 375 | × 2,25 |
| 4 | 376 – 500 | × 2,50 |
| 5 | 501 o más | × 3,00 |

**Parte 3 · Attach CARE y SEGUROS** — dos multiplicadores más, uno por el % de
attach de CARE y otro por el de SEGUROS:

| Tramo | Attach | Multiplicador |
|---|---|---|
| 1 | menos del 25 % | × 0,25 |
| 2 | 25 % – 45 % | × 0,75 |
| 3 | 45 % o más | × 1,35 |

> Nota: el ejemplo del email sitúa el 45 % exacto en el tramo alto
> (45 % de seguros → × 1,35), así que la app hace lo mismo.

Ejemplo verificado contra el email: 55.000 € → 137,50 € → × 2,25 (346 score)
= 309,37 € → × 1,35 × 1,35 = **563,83 €**.

El % de attach se calcula automáticamente como *ventas con CARE (o SEGURO) ÷
ventas totales del mes*. Si en la tienda lo miden de otra forma, se puede
escribir el % a mano con el botón ✎ de cada ficha.

## Funciones

- Alta de venta en segundos: importe, score y botones CARE / SEGURO.
- Incentivo estimado siempre visible, con el desglose del cálculo.
- Progreso hacia el siguiente tramo de facturación, score y attach.
- Historial por meses (navegación ‹ ›) y lista de ventas por día.
- Editar y borrar ventas.
- Exportar / importar copia de seguridad en JSON.

## Uso en el móvil

Abrir la página y usar "Añadir a pantalla de inicio" (Compartir → Añadir a
pantalla de inicio en iPhone) para tenerla como una app más.
