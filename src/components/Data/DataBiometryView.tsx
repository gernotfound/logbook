import { useSettingsProfile } from '../../hooks/useSettingsProfile';
import DataBiometry from './DataBiometry';

export default function DataBiometryView() {
    const editor = useSettingsProfile();
    return <DataBiometry editor={editor} />;
}
