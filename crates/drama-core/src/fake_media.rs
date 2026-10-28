//! 假供应商的产物：纯色 PNG（画上镜号，内置点阵字体）和按台词长度估时长的 WAV。
//! WAV 头手写；PNG 用 `png` crate 编码。

/// 3×5 点阵数字，每行低 3 位从左到右。
const DIGITS: [[u8; 5]; 10] = [
    [0b111, 0b101, 0b101, 0b101, 0b111],
    [0b010, 0b110, 0b010, 0b010, 0b111],
    [0b111, 0b001, 0b111, 0b100, 0b111],
    [0b111, 0b001, 0b111, 0b001, 0b111],
    [0b101, 0b101, 0b111, 0b001, 0b001],
    [0b111, 0b100, 0b111, 0b001, 0b111],
    [0b111, 0b100, 0b111, 0b101, 0b111],
    [0b111, 0b001, 0b001, 0b001, 0b001],
    [0b111, 0b101, 0b111, 0b101, 0b111],
    [0b111, 0b101, 0b111, 0b001, 0b111],
];

pub const PNG_W: u32 = 320;
pub const PNG_H: u32 = 180;
const SCALE: u32 = 10;

/// 由种子取一个不太亮的底色，数字用白色。
pub fn colour_for(seed: &str) -> [u8; 3] {
    let h = blake3::hash(seed.as_bytes());
    let b = h.as_bytes();
    [b[0] / 2 + 20, b[1] / 2 + 20, b[2] / 2 + 20]
}

/// 纯色底 + 居中的镜号。返回 PNG 字节。
pub fn shot_png(number: u32, bg: [u8; 3]) -> Vec<u8> {
    let (w, h) = (PNG_W, PNG_H);
    let mut px = vec![0u8; (w * h * 3) as usize];
    for c in px.chunks_exact_mut(3) {
        c.copy_from_slice(&bg);
    }
    let text = number.to_string();
    let glyph_w = 3 * SCALE;
    let gap = SCALE;
    let total = text.len() as u32 * glyph_w + (text.len() as u32 - 1) * gap;
    let x0 = w.saturating_sub(total) / 2;
    let y0 = h.saturating_sub(5 * SCALE) / 2;
    for (i, ch) in text.bytes().enumerate() {
        let g = DIGITS[(ch - b'0') as usize];
        let gx = x0 + i as u32 * (glyph_w + gap);
        for (row, bits) in g.iter().enumerate() {
            for col in 0..3u32 {
                if bits & (0b100 >> col) == 0 {
                    continue;
                }
                for dy in 0..SCALE {
                    for dx in 0..SCALE {
                        let x = gx + col * SCALE + dx;
                        let y = y0 + row as u32 * SCALE + dy;
                        if x < w && y < h {
                            let o = ((y * w + x) * 3) as usize;
                            px[o..o + 3].copy_from_slice(&[255, 255, 255]);
                        }
                    }
                }
            }
        }
    }
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgb);
        enc.set_depth(png::BitDepth::Eight);
        let mut wr = enc.write_header().expect("png header");
        wr.write_image_data(&px).expect("png data");
    }
    out
}

pub const WAV_RATE: u32 = 16_000;
/// 每个字（中日韩字、或一个英文词）约 250 毫秒，最短 1 秒。
pub const MS_PER_UNIT: u64 = 250;

pub fn estimate_speech_ms(text: &str) -> u64 {
    let mut units = 0u64;
    let mut in_word = false;
    for c in text.chars() {
        if c.is_alphanumeric() && c.is_ascii() {
            if !in_word {
                units += 1;
                in_word = true;
            }
        } else {
            in_word = false;
            if c.is_alphanumeric() {
                units += 1;
            }
        }
    }
    (units * MS_PER_UNIT).max(1000)
}

/// 16kHz 单声道 16 位 PCM；内容是很轻的 440Hz 正弦，ffprobe 可读。
pub fn wav(duration_ms: u64) -> Vec<u8> {
    let samples = (WAV_RATE as u64 * duration_ms / 1000) as u32;
    let data_len = samples * 2;
    let mut v = Vec::with_capacity(44 + data_len as usize);
    v.extend_from_slice(b"RIFF");
    v.extend_from_slice(&(36 + data_len).to_le_bytes());
    v.extend_from_slice(b"WAVE");
    v.extend_from_slice(b"fmt ");
    v.extend_from_slice(&16u32.to_le_bytes());
    v.extend_from_slice(&1u16.to_le_bytes()); // PCM
    v.extend_from_slice(&1u16.to_le_bytes()); // 单声道
    v.extend_from_slice(&WAV_RATE.to_le_bytes());
    v.extend_from_slice(&(WAV_RATE * 2).to_le_bytes()); // byte rate
    v.extend_from_slice(&2u16.to_le_bytes()); // block align
    v.extend_from_slice(&16u16.to_le_bytes()); // bits
    v.extend_from_slice(b"data");
    v.extend_from_slice(&data_len.to_le_bytes());
    for i in 0..samples {
        let t = i as f64 / WAV_RATE as f64;
        let s = ((t * 440.0 * std::f64::consts::TAU).sin() * 2000.0) as i16;
        v.extend_from_slice(&s.to_le_bytes());
    }
    v
}

/// 读 WAV 头算时长（毫秒）。只认上面这种简单 PCM 头。
pub fn wav_duration_ms(b: &[u8]) -> Option<u64> {
    if b.len() < 44 || &b[0..4] != b"RIFF" || &b[8..12] != b"WAVE" || &b[12..16] != b"fmt " {
        return None;
    }
    let byte_rate = u32::from_le_bytes(b[28..32].try_into().ok()?) as u64;
    if &b[36..40] != b"data" || byte_rate == 0 {
        return None;
    }
    let len = u32::from_le_bytes(b[40..44].try_into().ok()?) as u64;
    if 44 + len as usize > b.len() {
        return None;
    }
    Some(len * 1000 / byte_rate)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn png_decodes_with_expected_size_and_draws_digits() {
        let bytes = shot_png(12, [10, 20, 30]);
        let dec = png::Decoder::new(std::io::Cursor::new(&bytes));
        let mut r = dec.read_info().unwrap();
        let mut buf = vec![0; r.output_buffer_size()];
        let info = r.next_frame(&mut buf).unwrap();
        assert_eq!((info.width, info.height), (PNG_W, PNG_H));
        let px = &buf[..info.buffer_size()];
        assert_eq!(&px[0..3], &[10, 20, 30], "角落是底色");
        let white = px.chunks_exact(3).filter(|c| *c == [255, 255, 255]).count();
        assert!(white > 0, "画上了镜号");
        assert_ne!(shot_png(1, [10, 20, 30]), bytes, "不同镜号图不同");
    }

    #[test]
    fn wav_duration_is_within_ten_percent_of_estimate() {
        for text in ["你好", "今天天气不错，我们去公园散步吧。", "Hello there, how are you doing today?", ""] {
            let est = estimate_speech_ms(text);
            let got = wav_duration_ms(&wav(est)).unwrap();
            let diff = (got as f64 - est as f64).abs() / est as f64;
            assert!(diff <= 0.10, "{text}: est {est} got {got}");
        }
        assert_eq!(estimate_speech_ms("今天天气不错，我们去公园散步吧。"), 14 * MS_PER_UNIT);
        assert_eq!(estimate_speech_ms("Hello there, how are you doing today?"), 7 * MS_PER_UNIT);
        let w = wav(2000);
        assert_eq!(&w[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(w[4..8].try_into().unwrap()) as usize, w.len() - 8);
    }
}
