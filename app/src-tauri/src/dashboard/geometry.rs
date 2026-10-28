//! Window rectangles in physical pixels and the native resize-border hit test.
use serde::{Deserialize, Serialize};
use windows::Win32::Foundation::RECT;

/// Width of the resize border, and how far from a corner it still counts as the corner, in DIPs.
const BORDER_DIP: i32 = 12;
const CORNER_REACH_DIP: i32 = 32;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct Geometry {
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
}

impl From<RECT> for Geometry {
    fn from(rect: RECT) -> Self {
        Self {
            x: i64::from(rect.left),
            y: i64::from(rect.top),
            width: i64::from(rect.right - rect.left),
            height: i64::from(rect.bottom - rect.top),
        }
    }
}

impl Geometry {
    /// The rectangle as Win32 integers: any position, a positive size.
    pub fn to_win32(self) -> Result<(i32, i32, i32, i32), String> {
        let x = i32::try_from(self.x).map_err(|_| "x is outside Win32 range".to_owned())?;
        let y = i32::try_from(self.y).map_err(|_| "y is outside Win32 range".to_owned())?;
        let positive = |value: i64, name: &str| {
            i32::try_from(value)
                .ok()
                .filter(|value| *value > 0)
                .ok_or_else(|| format!("{name} must be a positive Win32 integer"))
        };
        Ok((
            x,
            y,
            positive(self.width, "width")?,
            positive(self.height, "height")?,
        ))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ResizeHit {
    NorthWest,
    North,
    NorthEast,
    East,
    SouthEast,
    South,
    SouthWest,
    West,
}

fn scaled_dip(value: i32, dpi: u32) -> i32 {
    ((i64::from(value) * i64::from(if dpi == 0 { 96 } else { dpi }) + 48) / 96).max(1) as i32
}

pub fn resize_hit(rect: Geometry, point: (i32, i32), dpi: u32) -> Option<ResizeHit> {
    let left = i32::try_from(rect.x).ok()?;
    let top = i32::try_from(rect.y).ok()?;
    let width = i32::try_from(rect.width).ok()?.max(1);
    let height = i32::try_from(rect.height).ok()?.max(1);
    let right = left.checked_add(width)?;
    let bottom = top.checked_add(height)?;
    let (x, y) = point;
    if x < left || x >= right || y < top || y >= bottom {
        return None;
    }

    let band_x = scaled_dip(BORDER_DIP, dpi).min((width / 2).max(1));
    let band_y = scaled_dip(BORDER_DIP, dpi).min((height / 2).max(1));
    let reach_x = scaled_dip(CORNER_REACH_DIP, dpi).min((width / 2).max(1));
    let reach_y = scaled_dip(CORNER_REACH_DIP, dpi).min((height / 2).max(1));
    let west = x < left + band_x;
    let east = x >= right - band_x;
    let north = y < top + band_y;
    let south = y >= bottom - band_y;
    if !(west || east || north || south) {
        return None;
    }

    let near_west = x - left < reach_x;
    let near_east = right - 1 - x < reach_x;
    let near_north = y - top < reach_y;
    let near_south = bottom - 1 - y < reach_y;
    if (west || north) && near_west && near_north {
        Some(ResizeHit::NorthWest)
    } else if (east || north) && near_east && near_north {
        Some(ResizeHit::NorthEast)
    } else if (east || south) && near_east && near_south {
        Some(ResizeHit::SouthEast)
    } else if (west || south) && near_west && near_south {
        Some(ResizeHit::SouthWest)
    } else if north {
        Some(ResizeHit::North)
    } else if east {
        Some(ResizeHit::East)
    } else if south {
        Some(ResizeHit::South)
    } else if west {
        Some(ResizeHit::West)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::{Geometry, ResizeHit, resize_hit};

    fn rect(x: i64, y: i64, width: i64, height: i64) -> Geometry {
        Geometry {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn validates_signed_positions_and_positive_win32_dimensions() {
        assert_eq!(
            rect(-1920, 0, 770, 392).to_win32(),
            Ok((-1920, 0, 770, 392))
        );
        assert!(rect(i32::MAX as i64 + 1, 0, 1, 1).to_win32().is_err());
        assert!(rect(0, 0, 0, 1).to_win32().is_err());
        assert!(rect(0, 0, i32::MAX as i64 + 1, 1).to_win32().is_err());
    }

    #[test]
    fn resize_hit_covers_all_directions_and_keeps_the_interior_client_area() {
        let window = rect(0, 0, 200, 100);
        let cases = [
            ((2, 2), ResizeHit::NorthWest),
            ((100, 2), ResizeHit::North),
            ((198, 2), ResizeHit::NorthEast),
            ((198, 50), ResizeHit::East),
            ((198, 98), ResizeHit::SouthEast),
            ((100, 98), ResizeHit::South),
            ((2, 98), ResizeHit::SouthWest),
            ((2, 50), ResizeHit::West),
        ];
        for (point, expected) in cases {
            assert_eq!(resize_hit(window, point, 96), Some(expected), "{point:?}");
        }
        assert_eq!(resize_hit(window, (100, 50), 96), None);
        assert_eq!(resize_hit(window, (-1, 50), 96), None);
        assert_eq!(resize_hit(window, (200, 50), 96), None);
    }

    #[test]
    fn resize_hit_scales_edges_and_handles_negative_origins() {
        let window = rect(-1920, -200, 800, 600);
        assert_eq!(
            resize_hit(window, (-1912, -100), 144),
            Some(ResizeHit::West)
        );
        assert_eq!(
            resize_hit(window, (-1909, -100), 192),
            Some(ResizeHit::West)
        );
        assert_eq!(resize_hit(window, (-1902, -100), 144), None);
        assert_eq!(resize_hit(window, (-1896, -100), 192), None);
        assert_eq!(
            resize_hit(window, (-1918, -198), 96),
            Some(ResizeHit::NorthWest)
        );
    }

    #[test]
    fn resize_hit_bounds_handles_for_tiny_windows_and_respects_edge_boundaries() {
        let tiny = rect(10, 20, 8, 8);
        assert_eq!(resize_hit(tiny, (10, 20), 96), Some(ResizeHit::NorthWest));
        assert_eq!(resize_hit(tiny, (17, 27), 96), Some(ResizeHit::SouthEast));
        let normal = rect(0, 0, 200, 100);
        assert_eq!(resize_hit(normal, (12, 50), 96), None);
        assert_eq!(resize_hit(normal, (11, 50), 96), Some(ResizeHit::West));
        assert_eq!(resize_hit(normal, (11, 31), 96), Some(ResizeHit::NorthWest));
        assert_eq!(resize_hit(normal, (11, 32), 96), Some(ResizeHit::West));
        assert_eq!(resize_hit(normal, (31, 11), 96), Some(ResizeHit::NorthWest));
        assert_eq!(resize_hit(normal, (32, 11), 96), Some(ResizeHit::North));
    }
}
