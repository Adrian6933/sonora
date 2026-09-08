//! Extraccion del icono real de un ejecutable.
//!
//! Windows no da el icono como imagen: da un HICON, que es un handle a dos
//! bitmaps de GDI (color y mascara). Hay que sacar los pixeles a mano con
//! GetDIBits y codificarlos nosotros.
//!
//! El resultado se cachea por ruta: el icono de un .exe no cambia mientras la
//! aplicacion vive, y esto es demasiado caro para repetirlo.

use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::{Mutex, OnceLock};

use base64::Engine;
use windows::core::PCWSTR;
use windows::Win32::Graphics::Gdi::{
    DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER,
    BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
};
use windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_NORMAL;
use windows::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};

fn cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Icono de un ejecutable como data URI PNG, listo para un `<img src>`.
pub fn icon_data_uri(path: &str) -> Option<String> {
    if path.is_empty() {
        return None;
    }

    if let Ok(map) = cache().lock() {
        if let Some(hit) = map.get(path) {
            return hit.clone();
        }
    }

    let result = extract(path).map(|png| {
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(png)
        )
    });

    if let Ok(mut map) = cache().lock() {
        map.insert(path.to_string(), result.clone());
    }

    result
}

fn extract(path: &str) -> Option<Vec<u8>> {
    let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
    let mut info = SHFILEINFOW::default();

    unsafe {
        SHGetFileInfoW(
            PCWSTR(wide.as_ptr()),
            FILE_ATTRIBUTE_NORMAL,
            Some(&mut info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        );
    }

    if info.hIcon.is_invalid() {
        return None;
    }

    let pixels = unsafe { icon_to_rgba(info.hIcon) };
    unsafe { DestroyIcon(info.hIcon).ok() };

    let (width, height, rgba) = pixels?;
    encode_png(width, height, &rgba)
}

/// HICON -> (ancho, alto, pixeles RGBA).
unsafe fn icon_to_rgba(icon: HICON) -> Option<(u32, u32, Vec<u8>)> {
    let mut icon_info = ICONINFO::default();
    unsafe { GetIconInfo(icon, &mut icon_info).ok()? };

    // Nos aseguramos de soltar los bitmaps pase lo que pase mas abajo.
    struct Bitmaps(HGDIOBJ, HGDIOBJ);
    impl Drop for Bitmaps {
        fn drop(&mut self) {
            unsafe {
                let _ = DeleteObject(self.0);
                let _ = DeleteObject(self.1);
            }
        }
    }
    let _guard = Bitmaps(icon_info.hbmColor.into(), icon_info.hbmMask.into());

    let mut bitmap = BITMAP::default();
    let read = unsafe {
        GetObjectW(
            icon_info.hbmColor.into(),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bitmap as *mut _ as *mut c_void),
        )
    };
    if read == 0 || bitmap.bmWidth <= 0 || bitmap.bmHeight <= 0 {
        return None;
    }

    let width = bitmap.bmWidth as u32;
    let height = bitmap.bmHeight as u32;

    let mut header = BITMAPINFO::default();
    header.bmiHeader = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: bitmap.bmWidth,
        // Negativo = filas de arriba a abajo. Con positivo saldria del reves.
        biHeight: -bitmap.bmHeight,
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB.0,
        ..Default::default()
    };

    let mut buffer = vec![0u8; (width * height * 4) as usize];

    let hdc = unsafe { GetDC(None) };
    let copied = unsafe {
        GetDIBits(
            hdc,
            icon_info.hbmColor,
            0,
            height,
            Some(buffer.as_mut_ptr() as *mut c_void),
            &mut header,
            DIB_RGB_COLORS,
        )
    };
    unsafe { ReleaseDC(None, hdc) };

    if copied == 0 {
        return None;
    }

    // GDI entrega BGRA; PNG quiere RGBA.
    for pixel in buffer.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }

    // Los iconos antiguos vienen con el canal alfa a cero en todo el bitmap: si
    // lo respetasemos, la imagen saldria invisible. En ese caso la tratamos
    // como opaca.
    if buffer.chunks_exact(4).all(|pixel| pixel[3] == 0) {
        for pixel in buffer.chunks_exact_mut(4) {
            pixel[3] = 255;
        }
    }

    Some((width, height, buffer))
}

fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(rgba).ok()?;
    }
    Some(out)
}
